// Vertical-slice behavior test against the demo backend (same domain rules as SQL).
import { describe, expect, it } from "vitest";
import { DemoApi } from "./demo";

describe("DemoApi vertical slice: capture → contact → timeline → assignment", () => {
  it("captures a new lead with timeline, assignment, attribution and score", async () => {
    const api = new DemoApi();
    const before = (await api.listContacts()).length;
    const id = await api.captureLead({
      idempotencyKey: "test-key-000000001",
      firstName: "Nina",
      lastName: "Buyer",
      email: "Nina@Example.com",
      phone: "555-444-1212",
      source: "referral",
      message: "Looking for a 3BR near downtown",
    });
    const result = await api.getContact(id);
    expect(result).not.toBeNull();
    const { contact, activities } = result!;
    expect(contact.email).toBe("nina@example.com");
    expect(contact.assigned_to).not.toBeNull();
    expect(contact.original_source).toBe("referral");
    expect(contact.lead_score).toBeGreaterThan(0);
    expect(activities.map((a) => a.activity_type)).toEqual(
      expect.arrayContaining(["capture", "assignment"]),
    );
    expect((await api.listContacts()).length).toBe(before + 1);
  });

  it("replays the same idempotency key without duplicating", async () => {
    const api = new DemoApi();
    const req = {
      idempotencyKey: "test-key-000000002",
      firstName: "Dup",
      lastName: "Licate",
      email: "dup@example.com",
      phone: "",
      source: "website",
    };
    const first = await api.captureLead(req);
    const count = (await api.listContacts()).length;
    const second = await api.captureLead(req);
    expect(second).toBe(first);
    expect((await api.listContacts()).length).toBe(count);
  });

  it("dedupes repeat inquiries and preserves original attribution", async () => {
    const api = new DemoApi();
    const first = await api.captureLead({
      idempotencyKey: "test-key-000000003",
      firstName: "Re",
      lastName: "Peat",
      email: "repeat@example.com",
      phone: "",
      source: "website",
    });
    const second = await api.captureLead({
      idempotencyKey: "test-key-000000004",
      firstName: "Re",
      lastName: "Peat",
      email: "REPEAT@example.com",
      phone: "",
      source: "zillow",
    });
    expect(second).toBe(first);
    const { contact } = (await api.getContact(first))!;
    expect(contact.original_source).toBe("website");
    expect(contact.latest_source).toBe("zillow");
  });

  it("records notes and stage changes on the timeline", async () => {
    const api = new DemoApi();
    const [c] = await api.listContacts();
    await api.addNote(c.id, "Spoke on the phone, wants a showing Saturday");
    await api.updateStage(c.id, "engaged");
    const { contact, activities } = (await api.getContact(c.id))!;
    expect(contact.stage).toBe("engaged");
    const types = activities.map((a) => a.activity_type);
    expect(types).toEqual(expect.arrayContaining(["note", "stage_change"]));
  });

  it("distributes leads round-robin across members", async () => {
    const api = new DemoApi();
    for (let i = 0; i < 6; i++) {
      await api.captureLead({
        idempotencyKey: `test-key-rr-00000${i}`,
        firstName: `L${i}`,
        lastName: "Robin",
        email: `rr${i}@example.com`,
        phone: "",
        source: "website",
      });
    }
    const contacts = await api.listContacts();
    const assignees = new Set(contacts.map((c) => c.assigned_to));
    expect(assignees.size).toBeGreaterThanOrEqual(3);
  });

  it("creates and completes tasks, logging contact-linked ones to the timeline", async () => {
    const api = new DemoApi();
    const [c] = await api.listContacts();
    const taskId = await api.createTask({ title: "Call about showing", contactId: c.id });
    let tasks = await api.listTasks();
    expect(tasks.find((t) => t.id === taskId)?.status).toBe("open");
    await api.setTaskStatus(taskId, "completed");
    tasks = await api.listTasks();
    expect(tasks.find((t) => t.id === taskId)?.status).toBe("completed");
    const { activities } = (await api.getContact(c.id))!;
    const taskEvents = activities.filter((a) => a.activity_type === "task");
    expect(taskEvents.length).toBe(2);
    await expect(api.createTask({ title: "  " })).rejects.toThrow(/title/);
    await expect(api.createTask({ title: "x", contactId: "nope" })).rejects.toThrow(/not found/);
  });

  it("rejects empty notes and unknown contacts", async () => {
    const api = new DemoApi();
    const [c] = await api.listContacts();
    await expect(api.addNote(c.id, "   ")).rejects.toThrow(/required/);
    await expect(api.addNote("nope", "hi")).rejects.toThrow(/not found/);
  });
});
