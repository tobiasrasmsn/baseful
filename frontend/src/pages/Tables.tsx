import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { TableIcon } from "@phosphor-icons/react";
import { useDatabase } from "@/context/DatabaseContext";
import { Facehash } from "facehash";

interface TableInfo {
  name: string;
  row_count: string;
}

interface ColumnInfo {
  name: string;
  type: string;
  nullable: string;
}

interface TableData {
  name: string;
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  count: number;
}

export default function Tables() {
  const { id } = useParams<{ id: string }>();
  const { selectedDatabase } = useDatabase();
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTableName, setSelectedTableName] = useState<string | null>(
    null,
  );
  const [selectedTable, setSelectedTable] = useState<TableData | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [editedCells, setEditedCells] = useState<Record<string, unknown>>({});
  const [originalValues, setOriginalValues] = useState<Record<string, unknown>>(
    {},
  );
  const [isSaving, setIsSaving] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(100);
  const [totalRows, setTotalRows] = useState(0);

  const hasChanges = Object.keys(editedCells).length > 0;

  const handleCellDoubleClick = (
    rowIndex: number,
    columnName: string,
    value: unknown,
  ) => {
    const cellKey = `${rowIndex}|||${columnName}`;
    if (!originalValues[cellKey]) {
      setOriginalValues((prev) => ({ ...prev, [cellKey]: value }));
    }
    setEditedCells((prev) => ({ ...prev, [cellKey]: value }));
  };

  const handleCellChange = (
    rowIndex: number,
    columnName: string,
    value: unknown,
  ) => {
    const cellKey = `${rowIndex}|||${columnName}`;
    setEditedCells((prev) => ({ ...prev, [cellKey]: value }));
  };

  const handleSave = async () => {
    if (!selectedTable || !id) return;
    setIsSaving(true);
    try {
      const primaryKey = selectedTable.columns[0]?.name;
      console.log("Primary key:", primaryKey);
      console.log("Edited cells:", editedCells);

      const updates = Object.entries(editedCells).map(([key, value]) => {
        const [rowIndexStr, columnName] = key.split("|||");
        const rowIndex = parseInt(rowIndexStr, 10);
        const row = selectedTable.rows[rowIndex];
        const rowId = primaryKey ? row[primaryKey] : null;
        console.log(
          `Update: row=${rowIndex}, column=${columnName}, value=${value}, rowId=${rowId}`,
        );
        return { rowId, columnName, value };
      });

      console.log("Sending updates:", { primaryKey, updates });

      const res = await fetch(
        `/api/databases/${id}/tables/${selectedTable.name}/rows`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ primaryKey, updates }),
        },
      );

      if (!res.ok) throw new Error("Failed to save changes");

      setEditedCells({});
      setOriginalValues({});
      fetchTableData(selectedTable.name);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscard = () => {
    setEditedCells({});
    setOriginalValues({});
  };

  useEffect(() => {
    if (id && selectedDatabase?.status === "active") {
      fetchTables();
    } else {
      setLoading(false);
    }
  }, [id, selectedDatabase]);

  const fetchTables = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/databases/${id}/tables`);
      if (!res.ok) throw new Error("Failed to fetch tables");
      const data = await res.json();
      setTables(data || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fetch tables");
    } finally {
      setLoading(false);
    }
  };

  const fetchTableData = async (
    tableName: string,
    page: number = 1,
    limit: number = 100,
  ) => {
    setSelectedTableName(tableName);
    setTableLoading(true);
    setSelectedTable(null);
    try {
      const offset = (page - 1) * limit;
      const res = await fetch(
        `/api/databases/${id}/tables/${tableName}?offset=${offset}&limit=${limit}`,
      );
      if (!res.ok) throw new Error("Failed to fetch table data");
      const data = await res.json();
      setSelectedTable(data || null);
      setTotalRows(data.totalCount || 0);
      setCurrentPage(page);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch table data",
      );
    } finally {
      setTableLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-neutral-400">Loading tables...</div>
      </div>
    );
  }

  if (error && !selectedDatabase) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-red-400">{error}</div>
        <Link to="/" className="text-blue-400 hover:text-blue-300">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-row border-b border-border p-4 items-center gap-4 w-full">
        <div className="flex flex-row items-center gap-3 flex-1">
          <Facehash
            name={selectedDatabase?.name || "database"}
            className="rounded-sm"
            colorClasses={[
              "bg-blue-500",
              "bg-orange-500",
              "bg-purple-500",
              "bg-lime-500",
              "bg-indigo-500",
              "bg-pink-500",
              "bg-teal-500",
              "bg-yellow-500",
              "bg-sky-500",
              "bg-fuchsia-500",
              "bg-rose-500",
              "bg-green-500",
            ]}
            size={32}
          />
          <div className="flex flex-row items-center gap-2">
            <h1 className="text-2xl font-medium text-neutral-100">Tables</h1>
          </div>
        </div>
      </div>

      {/* Main content */}
      {!selectedDatabase ? (
        <div className="flex-1 flex items-center justify-center bg-card border border-border rounded-lg">
          <p className="text-neutral-400">
            Select a database from the sidebar to view tables
          </p>
        </div>
      ) : selectedDatabase.status !== "active" ? (
        <div className="flex-1 flex items-center justify-center bg-card border border-border rounded-lg">
          <p className="text-amber-400">
            Database is not running. Start it to view tables.
          </p>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center bg-card border border-border rounded-lg">
          <p className="text-red-400">{error}</p>
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          {/* Tables sidebar */}
          <div className="w-64 shrink-0 p-4 overflow-hidden flex flex-col">
            <div className="overflow-y-auto flex-1">
              {tables?.map((table, i) => (
                <button
                  key={i}
                  onClick={() => fetchTableData(table.name)}
                  className={`w-full rounded-md flex flex-row items-center justify-between text-left px-3 py-1.5  hover:bg-neutral-800/50 transition-colors ${selectedTableName === table.name ? "bg-muted/75" : ""
                    }`}
                >
                  <div className="flex flex-row items-center gap-2">
                    <TableIcon
                      size={16}
                      className={
                        selectedTableName === table.name
                          ? "text-neutral-100"
                          : "text-neutral-500"
                      }
                    />
                    <span
                      className={`text-base ${selectedTableName === table.name
                          ? "text-neutral-100"
                          : "text-neutral-200"
                        }`}
                    >
                      {table.name}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Table content */}
          <div className="flex-1 flex flex-col min-h-0 border-l border-border overflow-hidden">
            {tableLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-neutral-400">Loading data...</div>
              </div>
            ) : !selectedTable ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <p className="text-neutral-400">
                    Select a table to view its contents
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Table header */}
                <div className="p-4 border-b border-border">
                  <div className="flex flex-row items-center justify-between gap-3">
                    <div>
                      <h2 className="text-2xl font-medium text-neutral-100">
                        {selectedTable.name}
                      </h2>
                      <p className="text-sm text-neutral-400">
                        {selectedTable.count} rows,{" "}
                        {selectedTable.columns.length} columns
                      </p>
                    </div>
                    {hasChanges && (
                      <div className="flex flex-row items-center gap-2">
                        <button
                          onClick={handleDiscard}
                          className="px-3 py-1.5 text-sm font-medium text-neutral-300 bg-neutral-700 hover:bg-neutral-600 rounded transition-colors"
                          disabled={isSaving}
                        >
                          Discard
                        </button>
                        <button
                          onClick={handleSave}
                          className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors"
                          disabled={isSaving}
                        >
                          {isSaving ? "Saving..." : "Save Changes"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                  {/* Data */}
                  <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                    {!selectedTable.rows || selectedTable.rows.length === 0 ? (
                      <div className="flex-1 flex items-center justify-center">
                        <div className="text-neutral-500">No data in table</div>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 overflow-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-transparent">
                              <tr className="border-b border-border sticky top-0">
                                {selectedTable.columns?.map((col, i) => (
                                  <th
                                    key={i}
                                    className="text-left py-2 px-4 text-neutral-400 font-medium bg-card"
                                  >
                                    {col.name}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {selectedTable.rows?.map((row, i) => (
                                <tr
                                  key={i}
                                  className="border-b border-border/50 hover:bg-neutral-800/50"
                                >
                                  {selectedTable.columns?.map((col, j) => {
                                    const cellKey = `${i}|||${col.name}`;
                                    const value =
                                      editedCells[cellKey] ?? row[col.name];
                                    const isEdited = cellKey in editedCells;
                                    return (
                                      <td
                                        key={j}
                                        className={`py-2 px-4 font-mono text-xs max-w-xs truncate border-l border-transparent ${isEdited ? "" : ""
                                          }`}
                                        onDoubleClick={() =>
                                          handleCellDoubleClick(
                                            i,
                                            col.name,
                                            row[col.name],
                                          )
                                        }
                                      >
                                        <input
                                          type="text"
                                          value={
                                            value === null ? "" : String(value)
                                          }
                                          onChange={(e) =>
                                            handleCellChange(
                                              i,
                                              col.name,
                                              e.target.value,
                                            )
                                          }
                                          className={`w-full bg-transparent border-none outline-none text-neutral-200 placeholder-neutral-600 ${isEdited ? "text-blue-200" : ""
                                            }`}
                                          placeholder={
                                            value === null ? "NULL" : undefined
                                          }
                                        />
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="p-3 border-t border-border flex items-center justify-between bg-neutral-800/30 shrink-0">
                          <div className="flex items-center gap-4">
                            <span className="text-xs text-neutral-500">
                              Showing{" "}
                              {Math.min(
                                (currentPage - 1) * rowsPerPage + 1,
                                totalRows,
                              )}{" "}
                              to{" "}
                              {Math.min(currentPage * rowsPerPage, totalRows)}{" "}
                              of {totalRows} rows
                            </span>
                            <div className="flex items-center gap-2">
                              <label className="text-xs text-neutral-500">
                                Rows per page:
                              </label>
                              <select
                                value={rowsPerPage}
                                onChange={(e) => {
                                  const newLimit = parseInt(e.target.value, 10);
                                  setRowsPerPage(newLimit);
                                  setCurrentPage(1);
                                  fetchTableData(
                                    selectedTable.name,
                                    1,
                                    newLimit,
                                  );
                                }}
                                className="text-xs bg-neutral-700 text-neutral-200 border border-border rounded px-2 py-1 outline-none focus:border-blue-500"
                              >
                                <option value={25}>25</option>
                                <option value={50}>50</option>
                                <option value={100}>100</option>
                                <option value={250}>250</option>
                                <option value={500}>500</option>
                              </select>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                if (currentPage > 1) {
                                  fetchTableData(
                                    selectedTable.name,
                                    currentPage - 1,
                                    rowsPerPage,
                                  );
                                }
                              }}
                              disabled={currentPage === 1}
                              className="p-1.5 rounded hover:bg-neutral-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                              title="Previous page"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="text-neutral-400"
                              >
                                <polyline points="15 18 9 12 15 6"></polyline>
                              </svg>
                            </button>
                            <span className="text-xs text-neutral-400 min-w-[60px] text-center">
                              Page {currentPage} of{" "}
                              {Math.ceil(totalRows / rowsPerPage) || 1}
                            </span>
                            <button
                              onClick={() => {
                                if (
                                  currentPage <
                                  Math.ceil(totalRows / rowsPerPage)
                                ) {
                                  fetchTableData(
                                    selectedTable.name,
                                    currentPage + 1,
                                    rowsPerPage,
                                  );
                                }
                              }}
                              disabled={
                                currentPage >=
                                Math.ceil(totalRows / rowsPerPage)
                              }
                              className="p-1.5 rounded hover:bg-neutral-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                              title="Next page"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="text-neutral-400"
                              >
                                <polyline points="9 18 15 12 9 6"></polyline>
                              </svg>
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
