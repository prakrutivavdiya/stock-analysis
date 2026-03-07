import { useState, useRef, useEffect } from "react";
import { Plus, Pencil, Trash2, AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";
import type { KPI } from "../data/mockData";
import { Switch } from "../components/ui/switch";
import { listKpis, createKpi, updateKpi, deleteKpi, mapKpi } from "../api/kpis";
import { ApiError } from "../api/client";

// L-01: Formula keyword autocomplete suggestions (SCALAR / BOOLEAN only)
const FORMULA_KEYWORDS = [
  "RSI(close, 14)",
  "RSI(close, 7)",
  "BB_UPPER(close, 20, 2)",
  "BB_LOWER(close, 20, 2)",
  "BB_MIDDLE(close, 20, 2)",
  "EMA(close, 9)",
  "EMA(close, 21)",
  "SMA(close, 50)",
  "SMA(close, 200)",
  "MACD(close, 12, 26, 9)",
  "ATR(14)",
  "PCT_FROM_52W_HIGH",
  "PCT_FROM_52W_LOW",
  "FUNDAMENTAL(pe)",
  "FUNDAMENTAL(eps)",
  "FUNDAMENTAL(pb)",
  "FUNDAMENTAL(marketcap)",
  "IF(",
  "AND",
  "OR",
  "NOT(",
  "ABS(",
  "MAX(",
  "MIN(",
  "close",
  "open",
  "high",
  "low",
  "volume",
];

// ── Categorical IF-chain types & helpers ──────────────────────────────────────

interface CategoricalCondition {
  condition: string; // full condition string, may use AND/OR e.g. "CLOSE >= BB_UPPER(20) AND RSI(14) > 70"
  label: string;
}

const DEFAULT_CAT_CONDITIONS: CategoricalCondition[] = [
  { condition: "CLOSE >= BB_UPPER(20)", label: "Sell Signal" },
  { condition: "CLOSE <= BB_LOWER(20)", label: "Buy Signal" },
];
const DEFAULT_CAT_DEFAULT = "Hold";

function splitIfArgs(inner: string): [string, string, string] | null {
  let depth = 0;
  let inString = false;
  const idx: number[] = [];
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '"') inString = !inString;
    else if (!inString) {
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === "," && depth === 0) {
        idx.push(i);
        if (idx.length === 2) break;
      }
    }
  }
  if (idx.length < 2) return null;
  return [
    inner.slice(0, idx[0]).trim(),
    inner.slice(idx[0] + 1, idx[1]).trim(),
    inner.slice(idx[1] + 1).trim(),
  ];
}

function parseCategoricalFormula(formula: string): {
  conditions: CategoricalCondition[];
  defaultLabel: string;
} {
  const f = formula.trim();
  // Convert legacy BB_POSITION(period) → equivalent conditions
  const bbMatch = /^BB_POSITION\s*\(\s*(\d+)\s*\)$/i.exec(f);
  if (bbMatch) {
    const p = bbMatch[1];
    return {
      conditions: [
        { condition: `CLOSE >= BB_UPPER(${p})`, label: "Sell Signal" },
        { condition: `CLOSE <= BB_LOWER(${p})`, label: "Buy Signal" },
      ],
      defaultLabel: "Hold",
    };
  }
  // Parse IF chain — store the full condition string (supports AND/OR)
  const conditions: CategoricalCondition[] = [];
  let current = f;
  while (true) {
    const strM = /^"([^"]+)"$/.exec(current);
    if (strM) return { conditions, defaultLabel: strM[1] };
    if (!/^IF\s*\(/i.test(current) || !current.endsWith(")")) break;
    const inner = current.slice(current.indexOf("(") + 1, -1);
    const parts = splitIfArgs(inner);
    if (!parts) break;
    const [condStr, labelStr, elseStr] = parts;
    const labelM = /^"([^"]+)"$/.exec(labelStr.trim());
    if (!labelM) break;
    conditions.push({ condition: condStr.trim(), label: labelM[1] });
    current = elseStr.trim();
  }
  // Fallback: default conditions if parsing failed
  return { conditions: DEFAULT_CAT_CONDITIONS, defaultLabel: DEFAULT_CAT_DEFAULT };
}

function serializeCategoricalFormula(
  conditions: CategoricalCondition[],
  defaultLabel: string
): string {
  if (conditions.length === 0) return `"${defaultLabel}"`;
  return conditions.reduceRight(
    (acc, c) => `IF(${c.condition}, "${c.label}", ${acc})`,
    `"${defaultLabel}"`
  );
}

// ── M-07: Type inference for SCALAR / BOOLEAN (not used for CATEGORICAL) ──────

function inferReturnType(formula: string): KPI["returnType"] | null {
  const f = formula.toUpperCase();
  if (
    f.includes(">") ||
    f.includes("<") ||
    /\b(AND|OR)\b/.test(f) ||
    f.startsWith("IF(") ||
    f.includes("=TRUE") ||
    f.includes("=FALSE")
  ) {
    if (f.startsWith("IF(") || f.includes('"')) return "CATEGORICAL";
    return "BOOLEAN";
  }
  if (
    f.startsWith("RSI(") ||
    f.startsWith("EMA(") ||
    f.startsWith("SMA(") ||
    f.startsWith("ATR(") ||
    f.startsWith("FUNDAMENTAL(") ||
    f.startsWith("PCT_")
  ) {
    return "SCALAR";
  }
  return null;
}

function detectTypeMismatch(
  formula: string,
  declaredType: KPI["returnType"]
): string | null {
  const inferred = inferReturnType(formula);
  if (!inferred || inferred === declaredType) return null;
  const typeLabels: Record<KPI["returnType"], string> = {
    SCALAR: "Scalar (number)",
    BOOLEAN: "Boolean (true/false)",
    CATEGORICAL: "Categorical (text)",
  };
  return `Formula looks like it returns ${typeLabels[inferred]}, but type is set to ${typeLabels[declaredType]}. Switch to ${typeLabels[inferred]}?`;
}

// ── Edit state ─────────────────────────────────────────────────────────────────

interface EditState {
  id?: string;
  name: string;
  formula: string;
  returnType: KPI["returnType"];
  description: string;
  active: boolean;
  catConditions: CategoricalCondition[];
  catDefault: string;
}

const EMPTY_EDIT: EditState = {
  name: "",
  formula: "",
  returnType: "SCALAR",
  description: "",
  active: true,
  catConditions: DEFAULT_CAT_CONDITIONS,
  catDefault: DEFAULT_CAT_DEFAULT,
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function KPIBuilder() {
  const [kpis, setKpis] = useState<KPI[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [edit, setEdit] = useState<EditState>(EMPTY_EDIT);
  const [saving, setSaving] = useState(false);

  // Load KPIs from backend on mount
  useEffect(() => {
    listKpis()
      .then((res) => setKpis(res.kpis.map(mapKpi)))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status !== 401) {
          toast.error(err.message || "Failed to load KPIs");
        }
      });
  }, []);

  // L-01: Autocomplete state (SCALAR/BOOLEAN only)
  const [acSuggestions, setAcSuggestions] = useState<string[]>([]);
  const [acIndex, setAcIndex] = useState(-1);
  const formulaRef = useRef<HTMLInputElement>(null);

  const openNew = () => {
    setEdit(EMPTY_EDIT);
    setEditOpen(true);
  };

  const openEdit = (kpi: KPI) => {
    const base: EditState = {
      id: kpi.id,
      name: kpi.name,
      formula: kpi.formula,
      returnType: kpi.returnType,
      description: kpi.description ?? "",
      active: kpi.active,
      catConditions: DEFAULT_CAT_CONDITIONS,
      catDefault: DEFAULT_CAT_DEFAULT,
    };
    if (kpi.returnType === "CATEGORICAL") {
      const parsed = parseCategoricalFormula(kpi.formula);
      base.catConditions = parsed.conditions;
      base.catDefault = parsed.defaultLabel;
    }
    setEdit(base);
    setEditOpen(true);
  };

  const handleDeleteKpi = async (id: string) => {
    try {
      await deleteKpi(id);
      setKpis((prev) => prev.filter((k) => k.id !== id));
      toast.success("KPI deleted");
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status !== 401) {
        toast.error(err.message || "Failed to delete KPI");
      }
    }
  };

  const toggleActive = async (id: string) => {
    const kpi = kpis.find((k) => k.id === id);
    if (!kpi) return;
    setKpis((prev) =>
      prev.map((k) => (k.id === id ? { ...k, active: !k.active } : k))
    );
    try {
      await updateKpi(id, { is_active: !kpi.active });
    } catch (err: unknown) {
      setKpis((prev) =>
        prev.map((k) => (k.id === id ? { ...k, active: kpi.active } : k))
      );
      if (err instanceof ApiError && err.status !== 401) {
        toast.error(err.message || "Failed to update KPI");
      }
    }
  };

  const handleSave = async () => {
    if (!edit.name.trim()) return;
    if (
      edit.returnType === "CATEGORICAL"
        ? edit.catConditions.length === 0 || !edit.catDefault.trim()
        : !edit.formula.trim()
    )
      return;

    const formulaToSend =
      edit.returnType === "CATEGORICAL"
        ? serializeCategoricalFormula(edit.catConditions, edit.catDefault)
        : edit.formula;

    setSaving(true);
    try {
      if (edit.id) {
        const updated = await updateKpi(edit.id, {
          name: edit.name,
          formula: formulaToSend,
          return_type: edit.returnType,
          description: edit.description || undefined,
          is_active: edit.active,
        });
        setKpis((prev) =>
          prev.map((k) => (k.id === edit.id ? mapKpi(updated) : k))
        );
        toast.success("KPI updated");
      } else {
        const created = await createKpi({
          name: edit.name,
          formula: formulaToSend,
          return_type: edit.returnType,
          description: edit.description || undefined,
        });
        setKpis((prev) => [...prev, mapKpi(created)]);
        toast.success("KPI created");
      }
      setEditOpen(false);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status !== 401) {
        toast.error(err.message || "Failed to save KPI");
      }
    } finally {
      setSaving(false);
    }
  };

  // L-01: Handle formula input with autocomplete (SCALAR/BOOLEAN only)
  const handleFormulaInput = (value: string) => {
    setEdit((e) => ({ ...e, formula: value }));
    setAcIndex(-1);
    const lastToken = value.split(/[\s,+\-*/()]+/).pop() ?? "";
    if (lastToken.length < 2) {
      setAcSuggestions([]);
      return;
    }
    const matches = FORMULA_KEYWORDS.filter((kw) =>
      kw.toLowerCase().startsWith(lastToken.toLowerCase())
    ).slice(0, 6);
    setAcSuggestions(matches);
  };

  const applyAcSuggestion = (suggestion: string) => {
    const formula = edit.formula;
    const lastTokenMatch = formula.match(/[\w%(]+$/);
    const prefix = lastTokenMatch
      ? formula.slice(0, formula.length - lastTokenMatch[0].length)
      : formula;
    setEdit((e) => ({ ...e, formula: prefix + suggestion }));
    setAcSuggestions([]);
    formulaRef.current?.focus();
  };

  const handleFormulaKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (acSuggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAcIndex((i) => Math.min(i + 1, acSuggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAcIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" || e.key === "Tab") {
      if (acIndex >= 0) {
        e.preventDefault();
        applyAcSuggestion(acSuggestions[acIndex]);
      }
    } else if (e.key === "Escape") {
      setAcSuggestions([]);
    }
  };

  // M-07: Mismatch warning (SCALAR/BOOLEAN only)
  const mismatch =
    edit.returnType !== "CATEGORICAL" && edit.formula.length > 3
      ? detectTypeMismatch(edit.formula, edit.returnType)
      : null;

  const isSaveDisabled =
    !edit.name.trim() ||
    saving ||
    (edit.returnType === "CATEGORICAL"
      ? edit.catConditions.length === 0 ||
        edit.catConditions.some((c) => !c.condition.trim() || !c.label.trim()) ||
        !edit.catDefault.trim()
      : !edit.formula.trim());

  const RETURN_TYPE_BADGE: Record<KPI["returnType"], string> = {
    SCALAR: "bg-blue-900/30 text-blue-400",
    BOOLEAN: "bg-purple-900/30 text-purple-400",
    CATEGORICAL: "bg-amber-900/30 text-amber-400",
  };

  // ── Categorical condition helpers ──────────────────────────────────────────
  const updateCondition = (
    idx: number,
    field: keyof CategoricalCondition,
    value: string
  ) => {
    setEdit((s) => ({
      ...s,
      catConditions: s.catConditions.map((c, i) =>
        i === idx ? { ...c, [field]: value } : c
      ),
    }));
  };

  const addCondition = () => {
    setEdit((s) => ({
      ...s,
      catConditions: [...s.catConditions, { condition: "", label: "" }],
    }));
  };

  const removeCondition = (idx: number) => {
    setEdit((s) => ({
      ...s,
      catConditions: s.catConditions.filter((_, i) => i !== idx),
    }));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a] bg-[#121212]">
        <div>
          <h1 className="text-lg font-semibold">KPI Builder</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Custom indicators computed per holding
          </p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-1.5 px-4 py-2 bg-[#FF6600] hover:bg-[#ff7700] text-white text-sm font-medium rounded transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add KPI
        </button>
      </div>

      {/* KPI table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#121212] border-b border-[#2a2a2a]">
            <tr>
              <th className="px-4 py-3 text-left text-muted-foreground font-medium">Name</th>
              <th className="px-4 py-3 text-left text-muted-foreground font-medium">Formula</th>
              <th className="px-4 py-3 text-left text-muted-foreground font-medium">Return Type</th>
              <th className="px-4 py-3 text-left text-muted-foreground font-medium">Description</th>
              <th className="px-4 py-3 text-left text-muted-foreground font-medium">Created</th>
              <th className="px-4 py-3 text-left text-muted-foreground font-medium">Active</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {kpis.map((kpi) => (
              <tr
                key={kpi.id}
                className="border-b border-[#1a1a1a] hover:bg-[#141414] transition-colors"
              >
                <td className="px-4 py-3 font-medium">{kpi.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground max-w-xs truncate">
                  {kpi.formula}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${RETURN_TYPE_BADGE[kpi.returnType]}`}
                  >
                    {kpi.returnType}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {kpi.description ?? "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{kpi.createdAt}</td>
                <td className="px-4 py-3">
                  <Switch checked={kpi.active} onCheckedChange={() => toggleActive(kpi.id)} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEdit(kpi)}
                      className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteKpi(kpi.id)}
                      className="p-1 text-muted-foreground hover:text-red-400 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit / New modal */}
      {editOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-[#2a2a2a] shrink-0">
              <h2 className="text-base font-semibold">
                {edit.id ? "Edit KPI" : "New KPI"}
              </h2>
            </div>

            <div className="px-6 py-5 space-y-4 overflow-y-auto">
              {/* Name */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Name</label>
                <input
                  type="text"
                  value={edit.name}
                  onChange={(e) => setEdit((s) => ({ ...s, name: e.target.value }))}
                  placeholder="e.g. Daily RSI"
                  className="w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#FF6600]"
                />
              </div>

              {/* Return type (above formula so it controls what's shown below) */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Return type</label>
                <select
                  value={edit.returnType}
                  onChange={(e) => {
                    const t = e.target.value as KPI["returnType"];
                    setEdit((s) => ({
                      ...s,
                      returnType: t,
                      catConditions:
                        t === "CATEGORICAL" && s.catConditions.length === 0
                          ? DEFAULT_CAT_CONDITIONS
                          : s.catConditions,
                      catDefault:
                        t === "CATEGORICAL" && !s.catDefault
                          ? DEFAULT_CAT_DEFAULT
                          : s.catDefault,
                    }));
                  }}
                  className="w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#FF6600]"
                >
                  <option value="SCALAR">Scalar — numeric value</option>
                  <option value="BOOLEAN">Boolean — true / false</option>
                  <option value="CATEGORICAL">Categorical — text label</option>
                </select>
              </div>

              {/* Formula — text input for SCALAR/BOOLEAN; structured editor for CATEGORICAL */}
              {edit.returnType !== "CATEGORICAL" ? (
                <div className="space-y-1.5 relative">
                  <label className="text-xs text-muted-foreground">
                    Formula
                    <span className="ml-2 text-muted-foreground/60">(type to autocomplete)</span>
                  </label>
                  <input
                    ref={formulaRef}
                    type="text"
                    value={edit.formula}
                    onChange={(e) => handleFormulaInput(e.target.value)}
                    onKeyDown={handleFormulaKeyDown}
                    onBlur={() => setTimeout(() => setAcSuggestions([]), 150)}
                    placeholder="e.g. RSI(14) > 70"
                    className="w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#FF6600]"
                  />
                  {/* Autocomplete dropdown */}
                  {acSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded shadow-lg z-10">
                      {acSuggestions.map((s, i) => (
                        <button
                          key={s}
                          onMouseDown={() => applyAcSuggestion(s)}
                          className={`w-full text-left px-3 py-2 text-sm font-mono transition-colors ${
                            i === acIndex
                              ? "bg-[#FF6600]/20 text-[#FF6600]"
                              : "text-muted-foreground hover:bg-[#2a2a2a] hover:text-foreground"
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* M-07: Type mismatch warning */}
                  {mismatch && (
                    <div className="flex items-start gap-2 mt-2 bg-amber-900/20 border border-amber-500/30 rounded px-3 py-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                      <div className="text-xs text-amber-400 flex-1">
                        {mismatch}
                        <button
                          className="ml-2 underline hover:no-underline"
                          onClick={() => {
                            const inferred = inferReturnType(edit.formula);
                            if (inferred) setEdit((s) => ({ ...s, returnType: inferred }));
                          }}
                        >
                          Switch type
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* Structured CATEGORICAL conditions editor */
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">
                    Conditions
                    <span className="ml-2 text-muted-foreground/50">
                      — evaluated top to bottom; first match wins
                    </span>
                  </label>

                  <div className="space-y-2">
                    {edit.catConditions.map((cond, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        {/* Condition — full expression, supports AND/OR */}
                        <input
                          type="text"
                          value={cond.condition}
                          onChange={(e) => updateCondition(idx, "condition", e.target.value)}
                          placeholder="e.g. CLOSE >= BB_UPPER(20) AND RSI(14) > 70"
                          className="flex-1 min-w-0 bg-[#0f0f0f] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-[#FF6600]"
                        />
                        <span className="text-muted-foreground/50 text-xs shrink-0">→</span>
                        {/* Label */}
                        <input
                          type="text"
                          value={cond.label}
                          onChange={(e) => updateCondition(idx, "label", e.target.value)}
                          placeholder="Sell Signal"
                          className="w-24 bg-[#0f0f0f] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs focus:outline-none focus:border-[#FF6600]"
                        />
                        {/* Delete */}
                        <button
                          onClick={() => removeCondition(idx)}
                          className="p-1 text-muted-foreground hover:text-red-400 transition-colors shrink-0"
                          title="Remove condition"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-1">
                    <button
                      onClick={addCondition}
                      className="text-xs text-[#FF6600] hover:text-[#ff7700] flex items-center gap-1 transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      Add condition
                    </button>
                    <p className="text-[10px] text-muted-foreground/40">
                      Use AND / OR to combine: <code>CLOSE &gt;= BB_UPPER(20) AND RSI(14) &gt; 70</code>
                    </p>
                  </div>

                  {/* Default label */}
                  <div className="flex items-center gap-2 pt-1 border-t border-[#2a2a2a]">
                    <span className="text-xs text-muted-foreground shrink-0">Default:</span>
                    <input
                      type="text"
                      value={edit.catDefault}
                      onChange={(e) => setEdit((s) => ({ ...s, catDefault: e.target.value }))}
                      placeholder="Hold"
                      className="flex-1 bg-[#0f0f0f] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs focus:outline-none focus:border-[#FF6600]"
                    />
                  </div>

                  {/* Preview of generated formula */}
                  {edit.catConditions.length > 0 && (
                    <p className="text-xs text-muted-foreground/50 font-mono break-all">
                      {serializeCategoricalFormula(edit.catConditions, edit.catDefault)}
                    </p>
                  )}
                </div>
              )}

              {/* Description */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Description (optional)</label>
                <input
                  type="text"
                  value={edit.description}
                  onChange={(e) => setEdit((s) => ({ ...s, description: e.target.value }))}
                  placeholder="Brief description"
                  className="w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#FF6600]"
                />
              </div>

              {/* Active toggle */}
              <div className="flex items-center justify-between">
                <label className="text-sm">Active</label>
                <Switch
                  checked={edit.active}
                  onCheckedChange={(v) => setEdit((s) => ({ ...s, active: v }))}
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-[#2a2a2a] flex justify-end gap-3 shrink-0">
              <button
                onClick={() => setEditOpen(false)}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaveDisabled}
                className="px-4 py-2 bg-[#FF6600] hover:bg-[#ff7700] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded transition-colors"
              >
                {saving ? "Saving…" : edit.id ? "Save" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
