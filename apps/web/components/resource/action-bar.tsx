"use client";

import { FileDown, MoreHorizontal, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteRecordAction, runRecordAction } from "@/app/(app)/[tenant]/actions";
import { Icon } from "@/components/icon";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import type { ClientAction } from "@batzio/server/resources/client";
import { FieldInput, type FormLabels } from "./field-input";
import { useT } from "@batzio/i18n/react";

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
}

function defaultsFor(action: ClientAction, context: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const f of action.input ?? []) {
    if (f.default === "$today") out[f.name] = todayIso();
    else if (f.default !== undefined) out[f.name] = f.default;
    if (f.name === "amount" && context.amount_open !== undefined) out.amount = String(context.amount_open);
  }
  return out;
}

export function ActionBar({
  tenant,
  resource,
  recordId,
  actions,
  canDelete,
  deleteLabel,
  pdfHref,
  context = {},
  primaryCount = 2,
}: {
  tenant: string;
  resource: string;
  recordId: number;
  actions: ClientAction[];
  canDelete: boolean;
  deleteLabel?: string;
  pdfHref?: string;
  context?: Record<string, unknown>;
  primaryCount?: number;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<ClientAction | null>(null);
  const [confirm, setConfirm] = useState<ClientAction | "delete" | null>(null);
  const [input, setInput] = useState<Record<string, unknown>>({});
  const [labels, setLabels] = useState<FormLabels>({});

  const execute = (action: ClientAction, payload: Record<string, unknown> = {}) =>
    start(async () => {
      const r = await runRecordAction(tenant, resource, recordId, action.name, payload);
      if (!r.ok) {
        toast.error(r.error ?? t("Action failed."));
        return;
      }
      toast.success(r.message ?? t("Done."));
      setDialog(null);
      setConfirm(null);
      if (r.redirect) router.push(r.redirect);
      else router.refresh();
    });

  const trigger = (action: ClientAction) => {
    if (action.input?.length) {
      setInput(defaultsFor(action, context));
      setLabels({});
      setDialog(action);
    } else if (action.confirm) setConfirm(action);
    else execute(action);
  };

  const doDelete = () =>
    start(async () => {
      const r = await deleteRecordAction(tenant, resource, recordId);
      if (!r.ok) {
        toast.error(r.error ?? t("Could not delete."));
        setConfirm(null);
        return;
      }
      toast.success(r.message);
      router.push(r.redirect ?? `/${tenant}/${resource}`);
    });

  // Destructive actions never become primary buttons.
  const safe = actions.filter((a) => a.variant !== "destructive");
  const primary = safe.slice(0, primaryCount);
  const secondary = [...safe.slice(primaryCount), ...actions.filter((a) => a.variant === "destructive")];
  /** Resolves "$record.<field>" placeholders in reference filters of action inputs. */
  const withContext = (field: NonNullable<ClientAction["input"]>[number]) =>
    field.refFilter
      ? {
          ...field,
          refFilter: Object.fromEntries(
            Object.entries(field.refFilter).map(([k, v]) => [k, typeof v === "string" && v.startsWith("$record.") ? (context[v.slice(8)] as string | number) : v]),
          ),
        }
      : field;

  return (
    <>
      {pdfHref && (
        <Button variant="outline" asChild>
          <a href={pdfHref} target="_blank" rel="noreferrer">
            <FileDown /> PDF
          </a>
        </Button>
      )}
      {primary.map((a, i) => (
        <Button key={a.name} variant={a.variant ?? (i === 0 ? "default" : "outline")} disabled={pending} onClick={() => trigger(a)}>
          {pending ? <Spinner /> : <Icon name={a.icon} />} {a.label}
        </Button>
      ))}
      {(secondary.length > 0 || canDelete) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label={t("More actions")}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {secondary.map((a) => (
              <DropdownMenuItem key={a.name} onSelect={() => trigger(a)} variant={a.variant === "destructive" ? "destructive" : "default"}>
                <Icon name={a.icon} /> {a.label}
              </DropdownMenuItem>
            ))}
            {canDelete && (
              <>
                {secondary.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("delete")}>
                  <Trash2 /> {deleteLabel ?? t("Delete")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog?.label}</DialogTitle>
            <DialogDescription>{dialog?.description}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (dialog) execute(dialog, input);
            }}
          >
            {dialog?.input?.map((f) => (
              <Field key={f.name}>
                <FieldLabel htmlFor={`a-${f.name}`}>
                  {f.label}
                  {f.required && <span className="text-destructive">*</span>}
                </FieldLabel>
                <FieldInput
                  id={`a-${f.name}`}
                  field={withContext(f)}
                  value={input[f.name]}
                  onChange={(v) => setInput((s) => ({ ...s, [f.name]: v }))}
                  tenant={tenant}
                  labels={labels}
                  onLabels={(k, l) => setLabels((s) => ({ ...s, [k]: l }))}
                />
              </Field>
            ))}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialog(null)}>
                {t("Cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Spinner />} {dialog?.label}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "delete" ? `${deleteLabel ?? t("Delete")}?` : confirm?.label}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "delete" ? t("This cannot be undone. The change is recorded in the audit log.") : confirm?.confirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (confirm === "delete") doDelete();
                else if (confirm) execute(confirm);
              }}
            >
              {pending && <Spinner />} {t("Confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
