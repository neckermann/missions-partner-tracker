import React, { useState } from "react";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";

// Shared add/edit/delete plumbing for the small partner-scoped record
// lists on Partner Detail (Adults, Children, Furloughs, Church Visits,
// Links, Languages) -- each is its own resource with its own endpoint
// (see backend/src/routes/partners.js's PUT comment), and each gets the
// identical "+Add" popup / per-row Edit / per-row Delete treatment, just
// with different form fields. This owns the create-vs-update state
// (`editingId` null means adding a new one) and the delete confirmation;
// the caller still owns the form's own field JSX and payload shaping.
export default function usePartnerRecordCrud({ createFn, updateFn, deleteFn, reload, confirmDialog }) {
  const [form, setForm] = useState(null);
  const [editingId, setEditingId] = useState(null);

  function openAdd(initial) {
    setEditingId(null);
    setForm(initial);
  }

  function openEdit(id, initial) {
    setEditingId(id);
    setForm(initial);
  }

  function close() {
    setForm(null);
    setEditingId(null);
  }

  async function submit(payload) {
    if (editingId) await updateFn(editingId, payload);
    else await createFn(payload);
    await reload();
  }

  async function handleDelete(item, describe) {
    const confirmed = await confirmDialog({
      title: describe ? describe(item) : "Delete this record?",
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    await deleteFn(item.id);
    await reload();
  }

  return { form, setForm, editingId, openAdd, openEdit, close, submit, handleDelete };
}
