"use client";

import qrcode from "qrcode-generator";
import { useMemo } from "react";
import { t as docLabel } from "@batzio/server/pdf/i18n";
import { formatIban } from "@batzio/core/swiss/iban";
import { buildQrPayload, referenceType, type QrAddress, type QrBillData } from "@batzio/core/swiss/qr-bill";
import { formatQrReference, formatScorReference } from "@batzio/core/swiss/references";

/**
 * The Swiss QR-bill (receipt + payment part) exactly as the PDF draws it:
 * same 105 mm slip, same positions in mm/pt, same official wording, and a
 * real, scannable QR code.
 */
function utf8Binary(value: string): string {
  return Array.from(new TextEncoder().encode(value), (b) => String.fromCharCode(b)).join("");
}

function addressLines(a: QrAddress | null | undefined): string[] {
  if (!a) return [];
  const street = [a.street, a.houseNumber].filter(Boolean).join(" ");
  return [a.name, street, `${a.country !== "CH" ? `${a.country}-` : ""}${a.postcode} ${a.town}`].filter(Boolean) as string[];
}

function slipAmount(amount: number): string {
  const [int, dec] = amount.toFixed(2).split(".");
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}.${dec}`;
}

/** Corner marks for fields left blank to be filled in by hand. */
function CornerBox({ width, height, style }: { width: number; height: number; style?: React.CSSProperties }) {
  const mark = (pos: React.CSSProperties, sides: string) => (
    <span className="absolute" style={{ width: "3mm", height: "3mm", borderColor: "black", borderStyle: "solid", borderWidth: sides, ...pos }} />
  );
  return (
    <div className="relative" style={{ width: `${width}mm`, height: `${height}mm`, ...style }}>
      {mark({ left: 0, top: 0 }, "0.75pt 0 0 0.75pt")}
      {mark({ right: 0, top: 0 }, "0.75pt 0.75pt 0 0")}
      {mark({ left: 0, bottom: 0 }, "0 0 0.75pt 0.75pt")}
      {mark({ right: 0, bottom: 0 }, "0 0.75pt 0.75pt 0")}
    </div>
  );
}

function QrCode({ payload }: { payload: string }) {
  const path = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(utf8Binary(payload), "Byte");
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { d, n };
  }, [payload]);
  const s = path.n;
  return (
    <svg viewBox={`0 0 ${s} ${s}`} className="absolute" style={{ left: "67mm", top: "17mm", width: "46mm", height: "46mm" }} shapeRendering="crispEdges" role="img" aria-label="QR code">
      <path d={path.d} fill="black" />
      <g transform={`translate(${s / 2} ${s / 2}) scale(${s / 46})`}>
        <rect x={-3.5} y={-3.5} width={7} height={7} fill="white" />
        <rect x={-3} y={-3} width={6} height={6} fill="black" />
        <rect x={-0.585} y={-1.945} width={1.17} height={3.89} fill="white" />
        <rect x={-1.945} y={-0.585} width={3.89} height={1.17} fill="white" />
      </g>
    </svg>
  );
}

export function QrSlip({ data, lang, className }: { data: QrBillData; lang: string; className?: string }) {
  const L = (k: Parameters<typeof docLabel>[1]) => docLabel(lang, k);
  const type = referenceType(data);
  const ref = type === "NON" || !data.reference ? null : type === "QRR" ? formatQrReference(data.reference) : formatScorReference(data.reference);
  const creditor = [formatIban(data.iban), ...addressLines(data.creditor)];
  const debtor = addressLines(data.debtor);
  const info = [data.message, data.billInformation].filter(Boolean).join(" ");
  const payload = buildQrPayload(data);
  const at = (x: number, y: number): React.CSSProperties => ({ position: "absolute", left: `${x}mm`, top: `${y}mm` });
  const head = { fontSize: "6pt", fontWeight: 700, lineHeight: "9pt" } as const;
  const val = { fontSize: "8pt", lineHeight: "9pt" } as const;

  return (
    <div className={className} style={{ position: "relative", width: "210mm", height: "105mm", color: "black", fontFamily: "Helvetica, Arial, sans-serif" }}>
      <p style={{ ...at(0, -3 - 2.2), width: "210mm", textAlign: "center", fontSize: "6pt", color: "rgb(77,77,77)" }}>{L("qr_separate")}</p>
      <div className="absolute inset-x-0 top-0 border-t border-dashed border-black" />
      <div className="absolute inset-y-0 border-l border-dashed border-black" style={{ left: "62mm" }} />

      {/* Receipt */}
      <p style={{ ...at(5, 5), fontSize: "11pt", fontWeight: 700, lineHeight: 1 }}>{L("qr_receipt")}</p>
      <div style={{ ...at(5, 12), width: "52mm" }}>
        <p style={head}>{L("qr_account")}</p>
        {creditor.map((l) => (
          <p key={l} style={val}>
            {l}
          </p>
        ))}
        <div style={{ height: "9pt" }} />
        {ref && (
          <>
            <p style={head}>{L("qr_reference")}</p>
            <p style={val}>{ref}</p>
            <div style={{ height: "9pt" }} />
          </>
        )}
        {debtor.length ? (
          <>
            <p style={head}>{L("qr_payable_by")}</p>
            {debtor.map((l) => (
              <p key={l} style={val}>
                {l}
              </p>
            ))}
          </>
        ) : (
          <>
            <p style={head}>{L("qr_payable_by_blank")}</p>
            <CornerBox width={52} height={20} />
          </>
        )}
      </div>
      <p style={{ ...at(5, 68), ...head }}>{L("qr_currency")}</p>
      <p style={{ ...at(22, 68), ...head }}>{L("qr_amount")}</p>
      <p style={{ ...at(5, 68 + 3.2), ...val }}>{data.currency}</p>
      {data.amount ? <p style={{ ...at(22, 68 + 3.2), ...val }}>{slipAmount(data.amount)}</p> : <CornerBox width={30} height={10} style={{ position: "absolute", left: "27mm", top: "68.7mm" }} />}
      <p style={{ ...at(0, 82), width: "57mm", textAlign: "right", ...head }}>{L("qr_acceptance")}</p>

      {/* Payment part */}
      <p style={{ ...at(67, 5), fontSize: "11pt", fontWeight: 700, lineHeight: 1 }}>{L("qr_payment_part")}</p>
      <QrCode payload={payload} />
      <p style={{ ...at(67, 68), fontSize: "8pt", fontWeight: 700, lineHeight: 1 }}>{L("qr_currency")}</p>
      <p style={{ ...at(87, 68), fontSize: "8pt", fontWeight: 700, lineHeight: 1 }}>{L("qr_amount")}</p>
      <p style={{ ...at(67, 68 + 3.9), fontSize: "10pt", lineHeight: 1 }}>{data.currency}</p>
      {data.amount ? (
        <p style={{ ...at(87, 68 + 3.9), fontSize: "10pt", lineHeight: 1 }}>{slipAmount(data.amount)}</p>
      ) : (
        <CornerBox width={40} height={15} style={{ position: "absolute", left: "78mm", top: "69.4mm" }} />
      )}
      <div style={{ ...at(118, 5), width: "87mm" }}>
        <p style={{ fontSize: "8pt", fontWeight: 700, lineHeight: "11pt" }}>{L("qr_account")}</p>
        {creditor.map((l) => (
          <p key={l} style={{ fontSize: "10pt", lineHeight: "11pt" }}>
            {l}
          </p>
        ))}
        <div style={{ height: "6pt" }} />
        {ref && (
          <>
            <p style={{ fontSize: "8pt", fontWeight: 700, lineHeight: "11pt" }}>{L("qr_reference")}</p>
            <p style={{ fontSize: "10pt", lineHeight: "11pt" }}>{ref}</p>
            <div style={{ height: "6pt" }} />
          </>
        )}
        {info && (
          <>
            <p style={{ fontSize: "8pt", fontWeight: 700, lineHeight: "11pt" }}>{L("qr_additional")}</p>
            <p style={{ fontSize: "10pt", lineHeight: "11pt" }}>{info}</p>
            <div style={{ height: "6pt" }} />
          </>
        )}
        {debtor.length ? (
          <>
            <p style={{ fontSize: "8pt", fontWeight: 700, lineHeight: "11pt" }}>{L("qr_payable_by")}</p>
            {debtor.map((l) => (
              <p key={l} style={{ fontSize: "10pt", lineHeight: "11pt" }}>
                {l}
              </p>
            ))}
          </>
        ) : (
          <>
            <p style={{ fontSize: "8pt", fontWeight: 700, lineHeight: "11pt" }}>{L("qr_payable_by_blank")}</p>
            <CornerBox width={65} height={25} />
          </>
        )}
      </div>
    </div>
  );
}
