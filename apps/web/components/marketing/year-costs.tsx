import { getT } from "@/lib/i18n/server";
import { Figures } from "./figures";

/**
 * A year of Batzio next to a year of bexio, from bexio's published prices
 * (annual plan, excl. VAT, checked 26.10.2026; sources on /vs/bexio).
 * “Like for like” is the cheapest bexio package with purchase orders,
 * supplier bills and payroll, which every Batzio plan includes.
 */
export async function YearCosts() {
  const t = await getT();
  const payroll = t("{package} + payroll", { package: "Optima" });
  const rows: [string, string, string, string][] = [
    [t("1 user"), "CHF 420.– · Basic", `CHF 1’128.– · ${payroll}`, "CHF 60.–"],
    [t("5 users"), "CHF 828.– · Optima", `CHF 1’128.– · ${payroll}`, "CHF 300.–"],
    [t("25 users"), "CHF 1’428.– · Ultimate", "CHF 1’428.– · Ultimate", "CHF 600.–"],
    [t("50 users"), t("On request"), t("On request"), "CHF 600.–"],
  ];
  return (
    <div className="neu-card overflow-x-auto">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <thead className="text-muted-foreground border-b text-xs">
          <tr>
            <th scope="col" className="px-5 py-3 font-semibold">
              {t("Team")}
            </th>
            <th scope="col" className="px-5 py-3 font-semibold">
              {t("bexio, cheapest package")}
            </th>
            <th scope="col" className="px-5 py-3 font-semibold">
              {t("bexio, like for like")}
            </th>
            <th scope="col" className="text-primary px-5 py-3 font-bold">
              Batzio
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([team, cheapest, like, ours]) => (
            <tr key={team} className="border-b last:border-b-0">
              <th scope="row" className="px-5 py-3.5 font-medium whitespace-nowrap">
                {team}
              </th>
              <td className="text-muted-foreground px-5 py-3.5">
                <Figures text={cheapest} />
              </td>
              <td className="text-muted-foreground px-5 py-3.5">
                <Figures text={like} />
              </td>
              <td className="num px-5 py-3.5 text-base font-semibold whitespace-nowrap">{ours}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
