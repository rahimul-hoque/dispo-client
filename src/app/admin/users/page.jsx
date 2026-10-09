"use client";

import { useState } from "react";
import { useSWRList } from "@/lib/use-swr-list";
import { Persons, PersonGear, TrashBin, TriangleExclamation } from "@gravity-ui/icons";
import { Modal, toast, useOverlayState, Spinner } from "@heroui/react";

const ROLES = ["customer", "owner", "admin"];

function UserRowSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-surface-container-low p-4 animate-pulse">
      <div className="h-10 w-10 rounded-full bg-surface-container" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-1/4 rounded-full bg-surface-container" />
        <div className="h-3 w-1/3 rounded-full bg-surface-container" />
      </div>
      <div className="h-9 w-28 rounded-full bg-surface-container" />
    </div>
  );
}

export default function AdminUsersPage() {
  const { list: users, setList: setUsers, isLoading } = useSWRList("/api/proxy/users", {
    onError: () => toast.danger("Couldn't load users", { description: "Check your connection and try again." }),
  });
  const [updatingId, setUpdatingId] = useState(null);

  const deleteModal = useOverlayState();
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const changeRole = async (user, newRole) => {
    if (newRole === user.role) return;
    setUpdatingId(user._id);
    try {
      const res = await fetch(`/api/proxy/users/${user._id}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      const result = await res.json();
      if (!res.ok) {
        toast.danger("Couldn't update role", { description: result.error || "Please try again." });
        return;
      }
      setUsers((prev) => prev.map((u) => (u._id === user._id ? { ...u, role: newRole } : u)));
      toast.success("Role updated", { description: `${user.name || user.email} is now ${newRole}.` });
    } catch (error) {
      console.log(error);
      toast.danger("Couldn't update role", { description: "Something went wrong." });
    } finally {
      setUpdatingId(null);
    }
  };

  const askDelete = (user) => {
    setDeleteTarget(user);
    deleteModal.open();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/proxy/users/${deleteTarget._id}`, { method: "DELETE" });
      const result = await res.json();
      if (!res.ok) {
        toast.danger("Couldn't delete user", { description: result.error || "Please try again." });
        return;
      }
      setUsers((prev) => prev.filter((u) => u._id !== deleteTarget._id));
      toast.success("User deleted", { description: `${deleteTarget.name || deleteTarget.email} was removed.` });
      deleteModal.close();
      setDeleteTarget(null);
    } catch (error) {
      console.log(error);
      toast.danger("Couldn't delete user", { description: "Something went wrong." });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <main className="w-full min-h-screen py-10 px-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-headline-lg text-headline-lg text-on-surface mb-1">Users & Roles</h1>
        <p className="font-body-md text-body-md text-on-surface-variant mb-8">
          Every account defaults to "customer" on signup. Promote people to owner or admin here \u2014
          this is the only place roles can change.
        </p>

        <div className="flex flex-col gap-3">
          {isLoading ? (
            <>
              <UserRowSkeleton />
              <UserRowSkeleton />
              <UserRowSkeleton />
            </>
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-[2rem] bg-surface-container-low py-16 px-6 text-center shadow-[inset_3px_3px_8px_rgba(184,196,214,0.4),inset_-3px_-3px_8px_rgba(255,255,255,0.8)]">
              <Persons className="h-8 w-8 text-tertiary mb-3" />
              <p className="font-headline-sm text-headline-sm text-on-surface">No users found</p>
            </div>
          ) : (
            users.map((user) => (
              <div
                key={user._id}
                className="flex items-center gap-4 rounded-2xl bg-surface-container-low p-4 shadow-[6px_6px_16px_rgba(184,196,214,0.5),-6px_-6px_16px_rgba(255,255,255,0.9)]"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface shadow-[inset_2px_2px_5px_rgba(184,196,214,0.5),inset_-2px_-2px_5px_rgba(255,255,255,0.9)]">
                  <PersonGear className="h-4 w-4 text-tertiary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-label-lg text-label-lg text-on-surface truncate">
                    {user.name || "Unnamed"}
                  </p>
                  <p className="font-body-sm text-body-sm text-on-surface-variant truncate">
                    {user.email}
                  </p>
                </div>
                <select
                  value={user.role || "customer"}
                  disabled={updatingId === user._id}
                  onChange={(e) => changeRole(user, e.target.value)}
                  className="shrink-0 rounded-full bg-surface-container px-4 py-2 font-label-md text-label-md text-on-surface focus:outline-none disabled:opacity-60"
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => askDelete(user)}
                  aria-label={`Delete ${user.name || user.email}`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-tertiary shadow-[3px_3px_8px_rgba(184,196,214,0.5),-3px_-3px_8px_rgba(255,255,255,0.9)] transition-colors hover:text-error cursor-pointer"
                >
                  <TrashBin className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Delete confirmation \u2014 permanent, so it always requires a deliberate second step */}
      <Modal state={deleteModal}>
        <Modal.Trigger className="hidden" aria-hidden="true" tabIndex={-1} />
        <Modal.Backdrop>
          <Modal.Container size="sm" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Icon>
                  <TriangleExclamation className="h-5 w-5 text-error" />
                </Modal.Icon>
                <Modal.Heading>Delete this user?</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <p className="font-body-md text-body-md text-on-surface-variant">
                  {deleteTarget
                    ? `"${deleteTarget.name || deleteTarget.email}" will be permanently deleted \u2014 this can't be undone. Any devices, products, or orders connected to this account are left untouched.`
                    : ""}
                </p>
              </Modal.Body>
              <Modal.Footer>
                <button
                  type="button"
                  onClick={() => deleteModal.close()}
                  disabled={isDeleting}
                  className="rounded-full px-5 py-2.5 font-label-lg text-label-lg text-on-surface-variant hover:bg-surface-container transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDelete}
                  disabled={isDeleting}
                  className="flex items-center gap-2 rounded-full bg-error px-5 py-2.5 font-label-lg text-label-lg text-on-error transition-opacity hover:opacity-90 cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isDeleting && <Spinner size="sm" color="current" />}
                  {isDeleting ? "Deleting..." : "Delete"}
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </main>
  );
}
