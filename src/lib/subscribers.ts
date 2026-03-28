import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SUBSCRIBERS_PATH = join(process.cwd(), "data", "subscribers.json");

export async function getSubscribers(): Promise<string[]> {
  try {
    const data = await readFile(SUBSCRIBERS_PATH, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export async function addSubscriber(email: string): Promise<boolean> {
  const subscribers = await getSubscribers();
  if (subscribers.includes(email)) {
    return false;
  }
  subscribers.push(email);
  await writeFile(SUBSCRIBERS_PATH, JSON.stringify(subscribers, null, 2));
  return true;
}
