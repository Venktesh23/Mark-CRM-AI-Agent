import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export function useRequireGeneratedEmails(count: number, redirectPath: string): boolean {
  const navigate = useNavigate();

  useEffect(() => {
    if (count === 0) navigate(redirectPath, { replace: true });
  }, [count, redirectPath, navigate]);

  return count > 0;
}
