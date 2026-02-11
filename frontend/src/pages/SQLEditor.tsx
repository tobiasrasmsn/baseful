import { useState } from "react";
import { useParams } from "react-router-dom";
import {
  PlayIcon,
  TableIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useDatabase } from "@/context/DatabaseContext";

interface QueryResult {
  result: string;
  is_select: boolean;
}

interface QueryHistory {
  id: number;
  query: string;
  timestamp: Date;
  success: boolean;
}

export default function SQLEditor() {
  const { id } = useParams<{ id: string }>();
  const { selectedDatabase } = useDatabase();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<QueryHistory[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const runQuery = async () => {
    if (!query.trim()) return;
    if (!selectedDatabase || selectedDatabase.status !== "active") {
      setError("Database is not running");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`/api/databases/${id}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Query failed");
      }

      const data = await res.json();
      setResult(data);

      // Add to history
      setHistory((prev) => [
        {
          id: Date.now(),
          query,
          timestamp: new Date(),
          success: true,
        },
        ...prev.slice(0, 49), // Keep last 50 queries
      ]);
    } catch (err: any) {
      setError(err.message);

      // Add failed query to history
      setHistory((prev) => [
        {
          id: Date.now(),
          query,
          timestamp: new Date(),
          success: false,
        },
        ...prev.slice(0, 49),
      ]);
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = () => {
    setHistory([]);
  };

  const loadFromHistory = (h: QueryHistory) => {
    setQuery(h.query);
    setShowHistory(false);
  };

  const formatResult = (
    output: string,
  ): { headers: string[]; rows: string[][] } | null => {
    const lines = output.trim().split("\n");
    if (lines.length < 2) return null;

    // Check if it's a table output (PostgreSQL format)
    if (lines[0].includes("(") || lines[0].startsWith("-")) {
      // Parse table output
      let headers: string[] = [];
      const rows: string[][] = [];

      // Find the header line (contains column names)
      let headerIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("|") && !lines[i].startsWith("(")) {
          headerIndex = i;
          break;
        }
      }

      if (headerIndex === -1) return null;

      // Parse header
      headers = lines[headerIndex]
        .split("|")
        .map((h) => h.trim())
        .filter((h) => h);

      // Parse rows (skip separator line)
      for (let i = headerIndex + 1; i < lines.length; i++) {
        if (
          lines[i].includes("|") &&
          !lines[i].startsWith("(") &&
          !lines[i].startsWith("-")
        ) {
          const cells = lines[i].split("|").map((c) => c.trim());
          if (cells.length === headers.length) {
            rows.push(cells);
          }
        }
      }

      return { headers, rows };
    }

    return null;
  };

  const tableData = result ? formatResult(result.result) : null;

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex flex-row border-b border-border p-4 items-center gap-4 w-full">
        <div className="flex flex-row items-center gap-3 flex-1">
          <div className="flex flex-row items-center gap-2">
            <h1 className="text-2xl font-medium text-neutral-100">
              SQL Editor
            </h1>
          </div>
        </div>
      </div>

      {showHistory && (
        <div className="bg-card border border-border rounded-lg p-4 max-h-48 overflow-y-auto">
          <div className="flex flex-row items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-neutral-300">
              Query History
            </h3>
            <button
              onClick={clearHistory}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Clear
            </button>
          </div>
          {history.length === 0 ? (
            <p className="text-sm text-neutral-500">No queries yet</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {history.map((h) => (
                <li
                  key={h.id}
                  onClick={() => loadFromHistory(h)}
                  className="text-xs text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 p-1.5 rounded cursor-pointer truncate"
                >
                  <span
                    className={h.success ? "text-green-400" : "text-red-400"}
                  >
                    {h.success ? "✓" : "✗"}
                  </span>{" "}
                  {h.query.substring(0, 80)}
                  {h.query.length > 80 ? "..." : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex-1 flex flex-col gap-2 min-h-0 p-12">
        <div className="flex-1 bg-card border border-border rounded-lg overflow-hidden">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="-- Enter your SQL query here
SELECT * FROM users LIMIT 10;"
            className="w-full h-full p-4 bg-transparent text-neutral-100 font-mono text-sm resize-none outline-none"
            spellCheck={false}
          />
        </div>

        <div className="flex flex-row items-center gap-2">
          <button
            onClick={runQuery}
            disabled={
              loading ||
              !selectedDatabase ||
              selectedDatabase.status !== "active"
            }
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md text-sm font-medium transition-colors"
          >
            <PlayIcon weight="bold" />
            {loading ? "Running..." : "Run Query"}
          </button>
          <button
            onClick={() => setQuery("")}
            className="flex items-center gap-2 px-3 py-2 bg-card hover:bg-accent border border-border text-neutral-300 rounded-md text-sm font-medium transition-colors"
          >
            <TrashIcon weight="bold" />
            Clear
          </button>
          <button
            onClick={() =>
              setQuery(
                "-- Sample queries\n\n-- List all tables\nSELECT * FROM information_schema.tables WHERE table_schema = 'public';\n\n-- List all columns in a table\nSELECT * FROM information_schema.columns WHERE table_name = 'your_table';",
              )
            }
            className="flex items-center gap-2 px-3 py-2 bg-card hover:bg-accent border border-border text-neutral-300 rounded-md text-sm font-medium transition-colors"
          >
            <TableIcon weight="bold" />
            Templates
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-md text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="p-12">
          <div className="flex-1 bg-card border border-border rounded-lg overflow-hidden flex flex-col min-h-0">
            <div className="p-3 border-b border-border bg-neutral-800/50">
              <h3 className="text-sm font-medium text-neutral-300">Results</h3>
            </div>
            <div className="flex-1 overflow-auto p-3">
              {tableData ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {tableData.headers.map((header, i) => (
                          <th
                            key={i}
                            className="text-left py-2 px-3 text-neutral-400 font-medium"
                          >
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableData.rows.map((row, i) => (
                        <tr
                          key={i}
                          className="border-b border-border/50 hover:bg-neutral-800/50"
                        >
                          {row.map((cell, j) => (
                            <td
                              key={j}
                              className="py-2 px-3 text-neutral-200 font-mono text-xs"
                            >
                              {cell || "NULL"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-xs text-neutral-500 mt-2">
                    {tableData.rows.length} row
                    {tableData.rows.length !== 1 ? "s" : ""} returned
                  </p>
                </div>
              ) : (
                <pre className="text-sm text-neutral-300 font-mono whitespace-pre-wrap">
                  {result.result}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}

      {!selectedDatabase && (
        <div className="flex-1 flex items-center justify-center bg-card border border-border rounded-lg">
          <p className="text-neutral-400">
            Select a database from the sidebar to run queries
          </p>
        </div>
      )}

      {selectedDatabase && selectedDatabase.status !== "active" && (
        <div className="flex-1 flex items-center justify-center bg-card border border-border rounded-lg">
          <p className="text-amber-400">
            Database is not running. Start it to run queries.
          </p>
        </div>
      )}
    </div>
  );
}
