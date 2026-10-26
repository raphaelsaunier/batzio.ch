"use client";

import { useId, useState } from "react";
import { useT } from "@batzio/i18n/react";

/** CHF per month: 5.– per user up to five, 50.– flat from six to fifty. */
export function monthlyPrice(users: number): number {
  return users <= 5 ? users * 5 : 50;
}

/** Slide to the size of your team, read the monthly and yearly price. */
export function PriceCalculator() {
  const t = useT();
  const id = useId();
  const [users, setUsers] = useState(3);
  const month = monthlyPrice(users);
  return (
    <div className="neu-card mx-auto grid max-w-3xl gap-6 p-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-8">
      <div className="space-y-4">
        <label htmlFor={id} className="font-display block text-lg font-semibold">
          {t("How many people use Batzio?")}
        </label>
        <div className="flex items-center gap-4">
          <input
            id={id}
            type="range"
            min={1}
            max={50}
            value={users}
            onChange={(e) => setUsers(Number(e.target.value))}
            className="accent-primary h-2 w-full cursor-pointer"
          />
          <output htmlFor={id} className="font-display num w-12 shrink-0 text-right text-3xl font-semibold">
            {users}
          </output>
        </div>
        <p className="text-muted-foreground text-sm">{users <= 5 ? t("CHF 5.– per user and month, up to 5 users.") : t("One flat price from 6 to 50 users.")}</p>
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-1 sm:text-right">
        <div>
          <dt className="text-muted-foreground text-sm">{t("per month")}</dt>
          <dd className="font-display num text-3xl font-semibold tracking-tight">CHF {month}.–</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-sm">{t("per year")}</dt>
          <dd className="font-display num text-3xl font-semibold tracking-tight">CHF {month * 12}.–</dd>
        </div>
      </dl>
    </div>
  );
}
