import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const events = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/events" }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    time: z.string(),
    location: z.string(),
    lumaUrl: z.string().url(),
    lumaEventId: z.string().optional(),
    description: z.string(),
    speakers: z.array(z.string()).default([]),
    cover: z.string().optional(),
    photos: z.array(z.string()).default([]),
    partner: z
      .object({
        name: z.string(),
        logo: z.string(),
        url: z.string().url(),
      })
      .optional(),
    status: z.enum(["upcoming", "past"]),
  }),
});

const speakers = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/speakers" }),
  schema: z.object({
    name: z.string(),
    role: z.string(),
    company: z.string(),
    photo: z.string(),
    links: z
      .object({
        linkedin: z.string().url().optional(),
        github: z.string().url().optional(),
        twitter: z.string().url().optional(),
        website: z.string().url().optional(),
      })
      .default({}),
  }),
});

export const collections = { events, speakers };
