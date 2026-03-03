import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/api";

export default function Home() {
  const { token, logout } = useAuth();
  const [message, setMessage] = useState("");

  useEffect(() => {
    authFetch("/api/hello", token, {}, logout)
      .then((res) => res.json())
      .then((data) => setMessage(data.message));
  }, [token, logout]);
  return <div className="p-12">{message}</div>;
}
