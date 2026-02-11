import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { useParams } from "react-router-dom";

interface Database {
  id: number;
  name: string;
  type: string;
  host: string;
  port: number;
  status: string;
  projectId: number;
}

interface DatabaseContextType {
  selectedDatabase: Database | null;
  setSelectedDatabase: (db: Database | null) => void;
  databases: Database[];
  refreshDatabases: () => Promise<void>;
}

const DatabaseContext = createContext<DatabaseContextType | null>(null);

export function useDatabase() {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error("useDatabase must be used within a DatabaseProvider");
  }
  return context;
}

interface DatabaseProviderProps {
  children: ReactNode;
}

export function DatabaseProvider({ children }: DatabaseProviderProps) {
  const [databases, setDatabases] = useState<Database[]>([]);
  const [selectedDatabase, setSelectedDatabase] = useState<Database | null>(
    null,
  );
  const { id: urlDbId } = useParams<{ id: string }>();

  const fetchDatabases = async () => {
    try {
      const response = await fetch("/api/databases");
      const data = await response.json();
      setDatabases(data || []);

      // Sync selected database with URL
      const databasesList = data || [];
      if (urlDbId) {
        const dbFromUrl = databasesList.find(
          (db: Database) => db.id === parseInt(urlDbId),
        );
        if (dbFromUrl) {
          setSelectedDatabase(dbFromUrl);
        }
      } else if (databasesList.length > 0 && !selectedDatabase) {
        setSelectedDatabase(databasesList[0]);
      }
    } catch (error) {
      console.error("Failed to fetch databases:", error);
    }
  };

  useEffect(() => {
    fetchDatabases();
  }, [urlDbId]);

  return (
    <DatabaseContext.Provider
      value={{
        selectedDatabase,
        setSelectedDatabase,
        databases,
        refreshDatabases: fetchDatabases,
      }}
    >
      {children}
    </DatabaseContext.Provider>
  );
}
