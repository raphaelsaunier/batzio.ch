"use client";

import { useEffect } from "react";
import { forgetLocalData } from "@/lib/local/store";

/** Signed out (or the session ran out): nothing of the previous account stays on this device. */
export function ForgetLocalData() {
  useEffect(() => {
    void forgetLocalData().catch(() => {});
  }, []);
  return null;
}
