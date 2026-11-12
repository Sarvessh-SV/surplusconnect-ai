"use client";

import React, { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { FoodCategory, InventoryLot, StorageType } from "@/lib/types";
import { Button } from "@/components/ui/primitives";
import { ModalDialog } from "@/components/ui/ModalDialog";
import { useToast } from "@/components/ui/ToastProvider";

interface InventoryFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (lot: InventoryLot) => void | Promise<void>;
  editingLot?: InventoryLot | null;
}

export function InventoryFormModal({
  open,
  onClose,
  onSaved,
  editingLot,
}: InventoryFormModalProps) {
  const { notify } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<FoodCategory>("bakery");
  const [quantityKg, setQuantityKg] = useState("");
  const [storageReq, setStorageReq] = useState<StorageType>("ambient");
  const [hoursUntilExpiry, setHoursUntilExpiry] = useState("24");
  const [retailValue, setRetailValue] = useState("150");
  const [packagingType, setPackagingType] = useState("Sealed food-grade crates");
  const [allergens, setAllergens] = useState("");
  const [autoCoordinate, setAutoCoordinate] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrorMsg(null);
    if (editingLot) {
      setTitle(editingLot.title);
      setDescription(editingLot.description);
      setCategory(editingLot.category);
      setQuantityKg(String(editingLot.quantity_kg));
      setStorageReq(editingLot.storage_requirement);
      const hrs = Math.max(
        2,
        Math.round(
          (new Date(editingLot.expires_at).getTime() - Date.now()) / 3600000
        )
      );
      setHoursUntilExpiry(String(hrs));
      setRetailValue(String(editingLot.estimated_retail_value_usd || 150));
      setPackagingType(editingLot.packaging_type || "Sealed food-grade crates");
      setAllergens((editingLot.allergens || []).join(", "));
    } else {
      setTitle("");
      setDescription("");
      setCategory("bakery");
      setQuantityKg("");
      setStorageReq("ambient");
      setHoursUntilExpiry("24");
      setRetailValue("150");
      setPackagingType("Sealed food-grade crates");
      setAllergens("");
      setAutoCoordinate(true);
    }
  }, [open, editingLot]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);

    try {
      const now = new Date();
      const expiry = new Date(
        now.getTime() + Number(hoursUntilExpiry || 24) * 3600 * 1000
      );
      const parsedAllergens = allergens
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      if (editingLot) {
        const res = await api.updateInventory(editingLot.id, {
          title: title.trim(),
          description: description.trim(),
          category,
          quantity_kg: Number(quantityKg),
          storage_requirement: storageReq,
          expires_at: expiry.toISOString(),
          packaging_type: packagingType.trim(),
          allergens: parsedAllergens,
          estimated_retail_value_usd: Number(retailValue) || 150,
        });
        notify({
          tone: "success",
          title: "Inventory updated",
          message: `${res.lot.title} has been saved.`,
        });
        await onSaved(res.lot);
        onClose();
      } else {
        const prepared = new Date(now.getTime() - 2 * 3600 * 1000);
        const res = await api.createInventory({
          title: title.trim(),
          description: description.trim(),
          category,
          quantity_kg: Number(quantityKg),
          storage_requirement: storageReq,
          prepared_at: prepared.toISOString(),
          expires_at: expiry.toISOString(),
          packaging_type: packagingType.trim(),
          allergens: parsedAllergens,
          estimated_retail_value_usd: Number(retailValue) || 150,
          historical_daily_turnover_kg: 60,
          auto_coordinate: autoCoordinate,
        });
        notify({
          tone: "success",
          title: "Surplus batch added",
          message: autoCoordinate
            ? `${res.lot.title} was added and matched with eligible recipients.`
            : `${res.lot.title} has been saved to your inventory.`,
        });
        await onSaved(res.lot);
        onClose();
      }
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError
          ? err.message
          : "Unable to save surplus item. Please check all fields."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title={editingLot ? "Edit Surplus Item" : "Add Surplus Inventory"}
      subtitle={
        editingLot
          ? "Update batch quantity, storage handling, or expiry window."
          : "Enter item details for automatic safety verification and recipient matching."
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMsg ? (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-danger-bg px-3.5 py-2.5 text-xs font-medium text-danger"
          >
            {errorMsg}
          </div>
        ) : null}

        <div>
          <label htmlFor="inv-title" className="block text-xs font-semibold text-forest mb-1.5">
            Product Name
          </label>
          <input
            id="inv-title"
            type="text"
            required
            minLength={3}
            placeholder="e.g., Fresh Bakery Bread & Pastries"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2.5 text-sm"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="inv-cat" className="block text-xs font-semibold text-forest mb-1.5">
              Category
            </label>
            <select
              id="inv-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value as FoodCategory)}
              className="w-full rounded-xl border border-border-subtle bg-white px-3 py-2.5 text-sm"
            >
              <option value="bakery">Bakery</option>
              <option value="produce">Produce</option>
              <option value="prepared_meals">Prepared Meals</option>
              <option value="dairy">Dairy</option>
              <option value="groceries">Groceries</option>
              <option value="frozen_goods">Frozen Goods</option>
              <option value="beverages">Beverages</option>
            </select>
          </div>

          <div>
            <label htmlFor="inv-stor" className="block text-xs font-semibold text-forest mb-1.5">
              Storage Type
            </label>
            <select
              id="inv-stor"
              value={storageReq}
              onChange={(e) => setStorageReq(e.target.value as StorageType)}
              className="w-full rounded-xl border border-border-subtle bg-white px-3 py-2.5 text-sm"
            >
              <option value="ambient">Ambient / Room Temp</option>
              <option value="dry_bulk">Dry Bulk</option>
              <option value="refrigerated">Refrigerated (0–4°C)</option>
              <option value="frozen">Frozen (-18°C)</option>
            </select>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="inv-qty" className="block text-xs font-semibold text-forest mb-1.5">
              Quantity (kg)
            </label>
            <input
              id="inv-qty"
              type="number"
              min="0.5"
              step="0.5"
              required
              placeholder="25"
              value={quantityKg}
              onChange={(e) => setQuantityKg(e.target.value)}
              className="w-full rounded-xl border border-border-subtle bg-white px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label htmlFor="inv-exp" className="block text-xs font-semibold text-forest mb-1.5">
              Expires In (hours)
            </label>
            <input
              id="inv-exp"
              type="number"
              min="1"
              max="720"
              required
              value={hoursUntilExpiry}
              onChange={(e) => setHoursUntilExpiry(e.target.value)}
              className="w-full rounded-xl border border-border-subtle bg-white px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label htmlFor="inv-val" className="block text-xs font-semibold text-forest mb-1.5">
              Est. Value ($)
            </label>
            <input
              id="inv-val"
              type="number"
              min="1"
              required
              value={retailValue}
              onChange={(e) => setRetailValue(e.target.value)}
              className="w-full rounded-xl border border-border-subtle bg-white px-3 py-2.5 text-sm"
            />
          </div>
        </div>

        <div>
          <label htmlFor="inv-desc" className="block text-xs font-semibold text-forest mb-1.5">
            Preparation &amp; Condition Notes
          </label>
          <textarea
            id="inv-desc"
            required
            minLength={5}
            rows={2}
            placeholder="Describe preparation, packaging, and handling details"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-xl border border-border-subtle bg-white px-3.5 py-2 text-sm"
          />
        </div>

        <details className="rounded-xl border border-border-subtle bg-canvas/60 px-3.5 py-2.5">
          <summary className="cursor-pointer text-xs font-semibold text-forest">
            Packaging &amp; Allergen Details (Optional)
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="inv-pack" className="block text-xs font-medium text-ink-muted mb-1">
                Packaging Type
              </label>
              <input
                id="inv-pack"
                type="text"
                value={packagingType}
                onChange={(e) => setPackagingType(e.target.value)}
                className="w-full rounded-xl border border-border-subtle bg-white px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="inv-all" className="block text-xs font-medium text-ink-muted mb-1">
                Allergens (comma-separated)
              </label>
              <input
                id="inv-all"
                type="text"
                placeholder="e.g., Wheat, Dairy"
                value={allergens}
                onChange={(e) => setAllergens(e.target.value)}
                className="w-full rounded-xl border border-border-subtle bg-white px-3 py-2 text-sm"
              />
            </div>
          </div>
        </details>

        {!editingLot ? (
          <label className="flex items-center gap-2.5 rounded-xl bg-mint-soft/50 px-3.5 py-2.5 text-xs font-medium text-forest cursor-pointer">
            <input
              type="checkbox"
              checked={autoCoordinate}
              onChange={(e) => setAutoCoordinate(e.target.checked)}
              className="h-4 w-4 accent-forest"
            />
            <span>Automatically find and match nearby eligible recipients</span>
          </label>
        ) : null}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            <Sparkles className="h-4 w-4" />
            {submitting
              ? "Saving..."
              : editingLot
              ? "Save Changes"
              : "Add Surplus"}
          </Button>
        </div>
      </form>
    </ModalDialog>
  );
}

