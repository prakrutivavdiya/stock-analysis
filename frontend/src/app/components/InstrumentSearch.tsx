import { useState, useEffect, useRef, useCallback } from "react";
import { Search } from "lucide-react";
import { searchInstruments } from "../api/instruments";
import type { InstrumentResult } from "../api/types";

interface InstrumentSearchProps {
  onSelect: (instrument: InstrumentResult) => void;
  placeholder?: string;
}

export default function InstrumentSearch({
  onSelect,
  placeholder = "Search instruments…",
}: InstrumentSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<InstrumentResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  const doSearch = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const res = await searchInstruments(q);
      setResults(res.results);
      setOpen(res.results.length > 0);
      setActiveIndex(-1);
    } catch {
      setResults([]);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    clearTimeout(timerRef.current);
    const q = query.trim();
    if (q.length === 0) {
      setResults([]);
      setOpen(false);
      return;
    }
    timerRef.current = setTimeout(() => doSearch(q), 300);
    return () => clearTimeout(timerRef.current);
  }, [query, doSearch]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (inst: InstrumentResult) => {
    onSelect(inst);
    setQuery("");
    setResults([]);
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      handleSelect(results[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div ref={containerRef} className="relative w-60">
      <div className="flex items-center bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 gap-2 h-8 focus-within:border-[#FF6600]/50">
        <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <input
          className="bg-transparent text-sm outline-none w-full placeholder:text-muted-foreground"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={handleKeyDown}
          aria-label="Search instruments"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        {loading && (
          <div className="w-3 h-3 border border-muted-foreground border-t-transparent rounded-full animate-spin flex-shrink-0" />
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded shadow-xl z-50 max-h-72 overflow-y-auto">
          {results.map((inst, i) => (
            <button
              key={inst.instrument_token}
              className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors ${
                i === activeIndex ? "bg-[#2a2a2a]" : "hover:bg-[#2a2a2a]"
              }`}
              onMouseDown={() => handleSelect(inst)}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-sm font-medium">{inst.tradingsymbol}</span>
                {inst.name && (
                  <span className="text-xs text-muted-foreground truncate">{inst.name}</span>
                )}
              </div>
              <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">{inst.exchange}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
