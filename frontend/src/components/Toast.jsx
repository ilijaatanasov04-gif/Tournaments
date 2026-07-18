import { useCallback, useState } from "react";
import { ToastContext } from "./toast";

let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const push = useCallback((message, kind = "info", duration = 4000) => {
    const id = nextId++;
    setToasts(prev => [...prev, { id, message, kind }]);
    if (duration > 0) setTimeout(() => remove(id), duration);
    return id;
  }, [remove]);

  const api = {
    info: (msg) => push(msg, "info"),
    success: (msg) => push(msg, "success"),
    error: (msg) => push(msg, "error", 5000),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => remove(t.id)}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
