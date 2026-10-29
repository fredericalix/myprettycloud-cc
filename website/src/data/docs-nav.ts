// Single source of truth for the docs sidebar AND prev/next ordering.
// `href` entries outside /docs/<slug> (e.g. /tutorial) appear in the sidebar
// but are excluded from prev/next pagination.

export interface DocsNavItem {
  slug: string | null;
  href: string;
  label: string;
}

export interface DocsNavGroup {
  group: string;
  items: DocsNavItem[];
}

export const docsNav: DocsNavGroup[] = [
  {
    group: "Getting started",
    items: [
      { slug: "introduction", href: "/docs", label: "Introduction" },
      { slug: null, href: "/tutorial", label: "Tutorial" },
    ],
  },
  {
    group: "The city",
    items: [
      { slug: "reading-the-city", href: "/docs/reading-the-city", label: "Reading the city" },
      { slug: "building-your-city", href: "/docs/building-your-city", label: "Building your city" },
      { slug: "the-mayor", href: "/docs/the-mayor", label: "The mayor" },
      { slug: "customization", href: "/docs/customization", label: "Seasons, ambiance & templates" },
    ],
  },
  {
    group: "Monitoring & alerting",
    items: [
      { slug: "inspecting-buildings", href: "/docs/inspecting-buildings", label: "Inspecting buildings" },
      { slug: "workflows", href: "/docs/workflows", label: "Workflows" },
      { slug: "notification-channels", href: "/docs/notification-channels", label: "Notification channels" },
      {
        slug: "groups-and-custom-monitors",
        href: "/docs/groups-and-custom-monitors",
        label: "Groups & custom monitors",
      },
    ],
  },
  {
    group: "Integrations",
    items: [{ slug: "mcp-and-integrations", href: "/docs/mcp-and-integrations", label: "MCP & webhooks" }],
  },
];

/** Flat, ordered list of collection-backed pages, for prev/next links. */
export const docsOrder: DocsNavItem[] = docsNav.flatMap((g) => g.items).filter((i) => i.slug !== null);
