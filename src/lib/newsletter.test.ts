import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const contacts = {
  get: vi.fn(),
  create: vi.fn(),
};

vi.mock("./resend", () => ({ resend: { contacts } }));

const { addSubscriber, isValidEmail, normalizeEmail, NewsletterUnavailableError } =
  await import("./newsletter");

describe("normalizeEmail", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeEmail("  ola@example.com  ")).toBe("ola@example.com");
  });

  it("lowercases so duplicates collapse", () => {
    expect(normalizeEmail("Ola@Example.COM")).toBe("ola@example.com");
  });
});

describe("isValidEmail", () => {
  it.each(["ola@example.com", "ola.nowak+news@sub.example.pl"])(
    "accepts %s",
    (email) => expect(isValidEmail(email)).toBe(true)
  );

  it.each(["", "ola", "ola@", "@example.com", "ola@example", "ola @example.com"])(
    "rejects %s",
    (email) => expect(isValidEmail(email)).toBe(false)
  );
});

describe("addSubscriber", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    vi.stubEnv("RESEND_AUDIENCE_ID", "test-audience");
    contacts.get.mockReset();
    contacts.create.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates the contact and reports a new subscription", async () => {
    contacts.get.mockResolvedValue({ data: null, error: { message: "not found" } });
    contacts.create.mockResolvedValue({ data: { id: "c1" }, error: null });

    await expect(addSubscriber("ola@example.com")).resolves.toBe("subscribed");
    expect(contacts.create).toHaveBeenCalledWith({
      email: "ola@example.com",
      audienceId: "test-audience",
    });
  });

  it("reports an existing contact without creating it again", async () => {
    contacts.get.mockResolvedValue({ data: { id: "c1" }, error: null });

    await expect(addSubscriber("ola@example.com")).resolves.toBe("already-subscribed");
    expect(contacts.create).not.toHaveBeenCalled();
  });

  it("throws when Resend rejects the create, so the route cannot report success", async () => {
    contacts.get.mockResolvedValue({ data: null, error: { message: "not found" } });
    contacts.create.mockResolvedValue({ data: null, error: { message: "rate limited" } });

    await expect(addSubscriber("ola@example.com")).rejects.toThrow("rate limited");
  });

  it("throws when the audience is not configured", async () => {
    vi.stubEnv("RESEND_AUDIENCE_ID", "");

    await expect(addSubscriber("ola@example.com")).rejects.toBeInstanceOf(
      NewsletterUnavailableError
    );
    expect(contacts.get).not.toHaveBeenCalled();
  });
});
