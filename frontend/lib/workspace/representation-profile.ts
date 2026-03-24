import {
  DEFAULT_REPRESENTATION_MODE,
  LANDLORD_REP_MODE,
  TENANT_REP_MODE,
  type RepresentationMode,
} from "@/lib/workspace/representation-mode";

export type RepresentationProfileModuleId =
  | "deals"
  | "buildings"
  | "financial-analyses"
  | "surveys"
  | "completed-leases"
  | "obligations";

export type RepresentationDealsViewMode =
  | "board"
  | "table"
  | "timeline"
  | "client_grouped"
  | "stacking_plan";

export interface RepresentationOnboardingStep {
  id: string;
  title: string;
  description: string;
  bullets: string[];
}

export interface RepresentationModuleConfig {
  id: RepresentationProfileModuleId;
  label: string;
  description: string;
  requiresAuth: boolean;
}

export interface RepresentationFeatureTile {
  step: string;
  title: string;
  description: string;
  ctaLabel: string;
  href: string;
  metricNoun: string;
  icon: "document" | "pipeline" | "reporting";
}

export interface RepresentationDashboardWidgetDefinition {
  id: string;
  label: string;
  description: string;
}

export interface RepresentationAiIntentPreset {
  id: string;
  resolvedIntent: string;
  focus: string;
  matchAny: string[];
  matchAll?: string[];
  toolCalls: Array<{
    tool: string;
    input: Record<string, unknown>;
  }>;
}

export interface RepresentationTemplatePreset {
  id: string;
  name: string;
  templateType: string;
  subjectTemplate: string;
  bodyTemplate: string;
  variables: string[];
  aiAssistEnabled: boolean;
}

export interface RepresentationReminderPreset {
  expirationMonths: number[];
  noticeDaysBefore: number[];
  overdueFollowUpDays: number[];
  staleListingDays: number;
  staleProposalDays: number;
}

export interface RepresentationExportDescriptor {
  excelDescriptor: string;
  pdfDescriptor: string;
  summary: string;
}

export interface RepresentationModeProfile {
  mode: RepresentationMode;
  label: string;
  summary: string;
  navigation: {
    defaultModule: RepresentationProfileModuleId;
    modules: readonly RepresentationModuleConfig[];
  };
  onboarding: {
    title: string;
    description: string;
    steps: readonly RepresentationOnboardingStep[];
    clientCreationTitle: string;
    clientCreationDescription: string;
  };
  hero: {
    defaultPrompt: string;
    capabilitiesLabel: string;
    workflowFooterPrefix: string;
    featureTiles: readonly RepresentationFeatureTile[];
  };
  crm: {
    defaultDealsView: RepresentationDealsViewMode;
    availableViews: readonly RepresentationDealsViewMode[];
    viewLabels: Record<RepresentationDealsViewMode, string>;
    commandCenterTitle: string;
    commandCenterDescription: string;
    operatingLayerTitle: string;
    operatingLayerFocus: string;
    intakeTitle: string;
    filtersTitle: string;
    relationshipGridTitle: string;
    locationIntelligenceTitle: string;
    followUpTitle: string;
    profileWorkspaceTitle: string;
    quickDealRequirementPlaceholder: string;
    quickDealBrokerPlaceholder: string;
    quickDealCounterpartyPlaceholder: string;
    pipelineSyncText: string;
    dashboardWidgets: readonly RepresentationDashboardWidgetDefinition[];
  };
  ai: {
    suggestedPrompts: readonly string[];
    defaultFallbackFocus: string;
    nextBestActions: readonly string[];
    intents: readonly RepresentationAiIntentPreset[];
  };
  reminders: RepresentationReminderPreset;
  templates: readonly RepresentationTemplatePreset[];
  exports: RepresentationExportDescriptor;
  docs: {
    docsSummary: string;
    securitySummary: string;
    contactSummary: string;
  };
}

const SHARED_MODULES: Record<RepresentationProfileModuleId, Omit<RepresentationModuleConfig, "id">> = {
  deals: {
    label: "CRM",
    description: "Pipeline lifecycle, linked workflows, and execution tracking.",
    requiresAuth: true,
  },
  buildings: {
    label: "Buildings",
    description: "Browse buildings, suite stacks, maps, and inventory handoffs.",
    requiresAuth: true,
  },
  "financial-analyses": {
    label: "Financial Analyses",
    description: "Financial modeling and side-by-side lease comparisons.",
    requiresAuth: false,
  },
  surveys: {
    label: "Surveys",
    description: "Structure market surveys and publish branded client views.",
    requiresAuth: true,
  },
  "completed-leases": {
    label: "Lease Abstracts",
    description: "Parse executed leases and generate abstract outputs.",
    requiresAuth: true,
  },
  obligations: {
    label: "Obligations",
    description: "Track obligation timelines, documents, and portfolio risk.",
    requiresAuth: true,
  },
};

function modulesForConfig(input: {
  order: readonly RepresentationProfileModuleId[];
  overrides?: Partial<Record<RepresentationProfileModuleId, Partial<Omit<RepresentationModuleConfig, "id">>>>;
}): readonly RepresentationModuleConfig[] {
  return input.order.map((id) => ({
    id,
    ...SHARED_MODULES[id],
    ...(input.overrides?.[id] || {}),
  }));
}

const TENANT_PROFILE: RepresentationModeProfile = {
  mode: TENANT_REP_MODE,
  label: "Tenant Rep",
  summary: "Relationship-centric advisory CRM for tenant-side brokerage.",
  navigation: {
    defaultModule: "deals",
    modules: modulesForConfig({
      order: ["deals", "buildings", "financial-analyses", "surveys", "completed-leases", "obligations"],
    }),
  },
  onboarding: {
    title: "Set up your tenant representation workspace",
    description: "Launch a company-first operating system for prospects, expirations, surveys, analyses, and follow-up cadence.",
    steps: [
      {
        id: "companies",
        title: "Companies and relationships",
        description: "Identify active clients, target prospects, and the key relationship owners driving each account.",
        bullets: ["Current clients", "Prospects", "Relationship owners"],
      },
      {
        id: "markets",
        title: "Markets and locations",
        description: "Anchor each company to the markets, submarkets, and buildings you care about most.",
        bullets: ["Target markets", "Submarkets", "Core locations"],
      },
      {
        id: "timing",
        title: "Expirations and follow up",
        description: "Capture lease timing so reminders, outreach, and next best actions stay proactive.",
        bullets: ["Lease expirations", "Notice dates", "Follow-up cadence"],
      },
    ],
    clientCreationTitle: "Create a company-centered workspace",
    clientCreationDescription: "This workspace will default to company profiles, client-grouped CRM views, and advisory next-best-actions.",
  },
  hero: {
    defaultPrompt: "Run a sublease recovery using the Austin obligation and these three proposals.",
    capabilitiesLabel: "CRM • Financial Analyses • Surveys • Lease Abstracts • Obligations • AI Workflows",
    workflowFooterPrefix: "client workflows active",
    featureTiles: [
      {
        step: "Step 1",
        title: "Ingest Documents",
        description: "Upload leases, amendments, proposals, flyers, and floorplans. AI structures every key term for advisory work.",
        ctaLabel: "Open Document Center",
        href: "/?module=financial-analyses#extract",
        metricNoun: "document",
        icon: "document",
      },
      {
        step: "Step 2",
        title: "Run Relationship Workflows",
        description: "Coordinate requirements, surveys, proposal comparisons, analyses, obligations, and relationship touchpoints in one company hub.",
        ctaLabel: "Open CRM",
        href: "/?module=deals",
        metricNoun: "workflow",
        icon: "pipeline",
      },
      {
        step: "Step 3",
        title: "Deliver Client Guidance",
        description: "Publish client-facing recommendations, occupancy cost views, obligation impacts, and next-step summaries.",
        ctaLabel: "Open Financial Analyses",
        href: "/?module=financial-analyses",
        metricNoun: "insight stream",
        icon: "reporting",
      },
    ],
  },
  crm: {
    defaultDealsView: "client_grouped",
    availableViews: ["board", "table", "timeline", "client_grouped"],
    viewLabels: {
      board: "Pipeline",
      table: "Table",
      timeline: "Timeline",
      client_grouped: "Records",
      stacking_plan: "Stacking Plan",
    },
    commandCenterTitle: "Tenant Representation CRM Command Center",
    commandCenterDescription: "Operate a polished tenant-side CRM across prospects, active clients, expirations, requirements, surveys, analyses, obligations, reminders, and AI-guided follow up.",
    operatingLayerTitle: "Company + Relationship Dashboard",
    operatingLayerFocus: "Expiring clients, expiring prospects, stale relationships, touchpoint cadence, and linked record momentum.",
    intakeTitle: "Prospect + Client Intake",
    filtersTitle: "Relationship + Requirement Filters",
    relationshipGridTitle: "Prospect + Client Coverage",
    locationIntelligenceTitle: "Market / Building / Suite Intelligence",
    followUpTitle: "Follow Up Engine",
    profileWorkspaceTitle: "Company Operating Hub",
    quickDealRequirementPlaceholder: "Requirement name",
    quickDealBrokerPlaceholder: "Tenant rep broker",
    quickDealCounterpartyPlaceholder: "Selected landlord",
    pipelineSyncText: "Prospects, clients, obligations, analyses, and deal stages stay tied together inside one operating layer.",
    dashboardWidgets: [
      { id: "expiring-clients", label: "Expiring Clients", description: "Clients with upcoming lease decisions." },
      { id: "expiring-prospects", label: "Expiring Prospects", description: "Prospects entering actionable lease windows." },
      { id: "stale-relationships", label: "Stale Relationships", description: "Companies with aging touchpoints." },
      { id: "active-deals", label: "Active Deals", description: "Open pursuits and requirement motion." },
      { id: "survey-activity", label: "Survey Activity", description: "Survey and proposal momentum." },
      { id: "touchpoint-queue", label: "Touchpoint Queue", description: "Follow-up items needing broker action." },
      { id: "next-best-actions", label: "Next Best Actions", description: "Suggested advisory actions." },
    ],
  },
  ai: {
    suggestedPrompts: [
      "Show me prospects expiring in the next 12 months.",
      "Draft renewal outreach for these clients.",
      "Compare these survey options by monthly occupancy cost.",
      "Run a sublease recovery using these proposals.",
      "Show clients we have not contacted recently.",
    ],
    defaultFallbackFocus: "tenant-general",
    nextBestActions: [
      "Follow up with expiring prospect",
      "Run renewal analysis",
      "Create survey",
      "Compare proposals",
    ],
    intents: [
      {
        id: "tenant-expiring-prospects",
        resolvedIntent: "tenant-expiring-prospects",
        focus: "tenant-expiring-prospects",
        matchAny: ["prospects expiring", "prospects expiring in the next 12 months", "expiring next year"],
        toolCalls: [{ tool: "generateClientSummary", input: { focus: "tenant-expiring-prospects" } }],
      },
      {
        id: "tenant-renewal-outreach",
        resolvedIntent: "tenant-renewal-outreach",
        focus: "tenant-renewal-outreach",
        matchAny: ["draft renewal outreach", "renewal outreach", "clients expiring"],
        toolCalls: [{ tool: "generateClientSummary", input: { focus: "tenant-renewal-outreach" } }],
      },
      {
        id: "tenant-survey-compare",
        resolvedIntent: "compare-survey-options",
        focus: "tenant-survey",
        matchAny: ["compare these survey", "survey options", "monthly occupancy cost"],
        toolCalls: [{ tool: "generateClientSummary", input: { focus: "tenant-survey" } }],
      },
      {
        id: "tenant-sublease",
        resolvedIntent: "create-sublease-recovery",
        focus: "tenant-sublease-recovery",
        matchAny: ["sublease recovery", "recovery using these proposals"],
        toolCalls: [
          { tool: "createSubleaseRecovery", input: {} },
          { tool: "compareProposals", input: {} },
        ],
      },
      {
        id: "tenant-stale-relationships",
        resolvedIntent: "tenant-stale-relationships",
        focus: "tenant-stale-relationships",
        matchAny: ["not contacted recently", "have not touched", "stale relationship"],
        toolCalls: [{ tool: "generateClientSummary", input: { focus: "tenant-stale-relationships" } }],
      },
    ],
  },
  reminders: {
    expirationMonths: [24, 18, 12, 9, 6],
    noticeDaysBefore: [180, 120, 90, 60, 30],
    overdueFollowUpDays: [30, 45, 60],
    staleListingDays: 60,
    staleProposalDays: 14,
  },
  templates: [
    {
      id: "crm_template_prospecting_follow_up",
      name: "Prospecting Follow Up",
      templateType: "prospecting",
      subjectTemplate: "Checking in on {{company_name}} and upcoming lease timing",
      bodyTemplate: "Hi {{prospect_name}},\n\nI wanted to reach out because {{company_name}} appears to be approaching an important lease window at {{building_name}} {{suite}} in {{submarket}}. If a renewal, relocation, or market check would be helpful, I can put together a quick overview.\n\nWould you be open to a short conversation next week?\n\nBest,\n{{broker_name}}",
      variables: ["prospect_name", "company_name", "building_name", "suite", "submarket", "broker_name"],
      aiAssistEnabled: true,
    },
    {
      id: "crm_template_renewal_checkin",
      name: "Renewal Check In",
      templateType: "renewal_follow_up",
      subjectTemplate: "Renewal planning for {{company_name}} at {{building_name}}",
      bodyTemplate: "Hi {{client_name}},\n\nWith {{lease_expiration}} approaching, I wanted to help you get in front of the next decision window at {{building_name}} {{suite}}. We can review renewal leverage, relocation alternatives, and notice timing so nothing is rushed.\n\nIf helpful, I can also prepare a comparison of your current position versus market options in {{market}}.\n\nBest,\n{{broker_name}}",
      variables: ["client_name", "company_name", "lease_expiration", "building_name", "suite", "market", "broker_name"],
      aiAssistEnabled: true,
    },
    {
      id: "crm_template_proposal_follow_up",
      name: "Proposal Follow Up",
      templateType: "proposal_follow_up",
      subjectTemplate: "Next steps on the proposal for {{company_name}}",
      bodyTemplate: "Hi {{company_name}},\n\nI wanted to follow up on the proposal and outline the decisions that would keep timing on track. I can summarize economics, open issues, and timing considerations before the next round.\n\nPlease let me know if you would like a marked-up summary or a quick call.\n\nBest,\n{{broker_name}}",
      variables: ["company_name", "broker_name"],
      aiAssistEnabled: true,
    },
    {
      id: "crm_template_landlord_outreach",
      name: "Client Touchpoint Summary",
      templateType: "client_update",
      subjectTemplate: "Update for {{company_name}}",
      bodyTemplate: "Hi {{client_name}},\n\nI wanted to send a quick update on your active real estate items, including upcoming critical dates, active pursuits, and recommended next steps.\n\nIf helpful, I can also prepare a refreshed dashboard or analysis package.\n\nBest,\n{{broker_name}}",
      variables: ["client_name", "company_name", "building_name", "market", "broker_name"],
      aiAssistEnabled: true,
    },
  ],
  exports: {
    excelDescriptor: "Financial Analysis",
    pdfDescriptor: "Economic Presentation",
    summary: "Client-facing options, occupancy cost, recommendations, and obligation impact.",
  },
  docs: {
    docsSummary: "Tenant mode centers company relationships, expirations, analyses, obligations, and client-facing advisory workflows.",
    securitySummary: "Tenant mode changes workflow emphasis and reminders only; shared security and data boundaries stay intact.",
    contactSummary: "For tenant-side issues, include the company, relationship stage, and which advisory workflow was affected.",
  },
};

const LANDLORD_PROFILE: RepresentationModeProfile = {
  mode: LANDLORD_REP_MODE,
  label: "Landlord Rep",
  summary: "Building-first leasing operations console for landlord-side brokerage.",
  navigation: {
    defaultModule: "deals",
    modules: modulesForConfig({
      order: ["deals", "buildings", "financial-analyses", "surveys", "completed-leases", "obligations"],
      overrides: {
        deals: {
          label: "Leasing Console",
          description: "Portfolio, building, suite, inquiry, proposal, and execution workflows.",
        },
        buildings: {
          label: "Buildings",
          description: "Portfolio map, stack plans, suite availability, and building-led workflow control.",
        },
        "financial-analyses": {
          label: "Availabilities",
          description: "Availability inventory, suite economics, and listing positioning.",
        },
        surveys: {
          label: "Marketing",
          description: "Marketing package workflows, flyers, and listing collateral.",
        },
        "completed-leases": {
          label: "Lease Tracking",
          description: "Lease execution tracking and closed package records.",
        },
        obligations: {
          label: "Reporting",
          description: "Property performance, expirations, and ownership reporting.",
        },
      },
    }),
  },
  onboarding: {
    title: "Set up your landlord representation workspace",
    description: "Launch a building-first leasing operations layer for portfolio activity, suite intelligence, and ownership reporting.",
    steps: [
      {
        id: "portfolio",
        title: "Portfolio and buildings",
        description: "Start with portfolio coverage, building inventory, and the properties you want to operate from day one.",
        bullets: ["Portfolio", "Buildings", "Ownership groups"],
      },
      {
        id: "inventory",
        title: "Suites and availabilities",
        description: "Capture the physical stack so the workspace can reason about vacancies, occupancies, and suite activity.",
        bullets: ["Floors", "Suites", "Availabilities"],
      },
      {
        id: "pipeline",
        title: "Expirations and pipeline",
        description: "Seed the leasing console with tenant expirations, inquiries, tours, and proposal motion.",
        bullets: ["Tenant expirations", "Inquiry pipeline", "Tour activity"],
      },
    ],
    clientCreationTitle: "Create a building-centered workspace",
    clientCreationDescription: "This workspace will default to stacking-plan views, landlord reminders, and ownership-facing next-best-actions.",
  },
  hero: {
    defaultPrompt: "Show me all suites expiring in the next 12 months in this building.",
    capabilitiesLabel: "Leasing Console • Availabilities • Marketing • Lease Tracking • Reporting • AI Workflows",
    workflowFooterPrefix: "leasing workflows active",
    featureTiles: [
      {
        step: "Step 1",
        title: "Ingest Listing Docs",
        description: "Upload leases, floorplans, flyers, proposals, and marketing collateral. AI classifies suite-level listing inputs.",
        ctaLabel: "Open Availabilities",
        href: "/?module=financial-analyses#extract",
        metricNoun: "document",
        icon: "document",
      },
      {
        step: "Step 2",
        title: "Operate the Leasing Console",
        description: "Track tours, proposals, negotiation movement, expirations, and suite coverage from one building-first console.",
        ctaLabel: "Open Leasing Console",
        href: "/?module=deals",
        metricNoun: "workflow",
        icon: "pipeline",
      },
      {
        step: "Step 3",
        title: "Publish Ownership Reporting",
        description: "Generate operational outputs for availability status, proposal pipeline, signed deals, expirations, and downtime exposure.",
        ctaLabel: "Open Reporting",
        href: "/?module=obligations",
        metricNoun: "reporting stream",
        icon: "reporting",
      },
    ],
  },
  crm: {
    defaultDealsView: "stacking_plan",
    availableViews: ["stacking_plan", "board", "table", "timeline"],
    viewLabels: {
      board: "Pipeline",
      table: "Table",
      timeline: "Timeline",
      client_grouped: "Records",
      stacking_plan: "Stacking Plan",
    },
    commandCenterTitle: "Landlord Representation Leasing Console",
    commandCenterDescription: "Operate a modern landlord-side leasing system across portfolio metrics, building intelligence, availabilities, tours, proposals, negotiations, execution, reminders, and AI-guided updates.",
    operatingLayerTitle: "Portfolio + Building Dashboard",
    operatingLayerFocus: "Vacancies, tenant expirations, tour motion, proposal pipeline, negotiation status, signed deals, and downtime exposure.",
    intakeTitle: "Occupancy + Prospect Intake",
    filtersTitle: "Portfolio + Building Filters",
    relationshipGridTitle: "Tenant + Prospect Coverage",
    locationIntelligenceTitle: "Market / Submarket / Building / Floor / Suite",
    followUpTitle: "Leasing Follow Up Engine",
    profileWorkspaceTitle: "Building Operating Hub",
    quickDealRequirementPlaceholder: "Listing / suite summary",
    quickDealBrokerPlaceholder: "Listing broker",
    quickDealCounterpartyPlaceholder: "Prospect / tenant",
    pipelineSyncText: "Listings, tours, proposals, occupancies, and signed deals stay tied to suite-level CRM intelligence.",
    dashboardWidgets: [
      { id: "portfolio-vacancies", label: "Portfolio Vacancies", description: "Vacant suites across tracked buildings." },
      { id: "expiring-tenants", label: "Expiring Tenants", description: "Occupancies approaching action windows." },
      { id: "tour-activity", label: "Tour Activity", description: "Buildings and suites with active tours." },
      { id: "proposal-pipeline", label: "Proposal Pipeline", description: "Suites with proposals or counters underway." },
      { id: "negotiation-pipeline", label: "Negotiation Pipeline", description: "Deals moving through negotiation." },
      { id: "signed-deals", label: "Signed Deals", description: "Executed leasing outcomes." },
      { id: "downtime-risk", label: "Downtime Risk", description: "Suites most exposed to upcoming vacancy." },
    ],
  },
  ai: {
    suggestedPrompts: [
      "Show suites expiring in this building.",
      "Summarize tour activity for this building.",
      "Which availabilities have active proposals?",
      "Generate an ownership update for this property.",
      "Show downtime exposure across this portfolio.",
    ],
    defaultFallbackFocus: "landlord-general",
    nextBestActions: [
      "Review expiring tenant",
      "Follow up after tour",
      "Send proposal update",
      "Generate ownership report",
    ],
    intents: [
      {
        id: "landlord-expiring-suites",
        resolvedIntent: "landlord-expiring-suites",
        focus: "landlord-expiring-suites",
        matchAny: ["suites expiring", "expiring in this building", "expiring in the next 12 months"],
        toolCalls: [{ tool: "generateClientSummary", input: { focus: "landlord-expiring-suites" } }],
      },
      {
        id: "landlord-tour-activity",
        resolvedIntent: "landlord-tour-activity",
        focus: "landlord-tour-activity",
        matchAny: ["summarize tour activity", "tour activity", "toured prospects"],
        toolCalls: [{ tool: "generateClientSummary", input: { focus: "landlord-tour-activity" } }],
      },
      {
        id: "landlord-availability-proposals",
        resolvedIntent: "landlord-availability-proposals",
        focus: "landlord-availability-proposals",
        matchAny: ["availabilities have active proposals", "availabilities with proposals", "active proposals outstanding"],
        toolCalls: [{ tool: "generateClientSummary", input: { focus: "landlord-availability-proposals" } }],
      },
      {
        id: "landlord-ownership-update",
        resolvedIntent: "landlord-ownership-update",
        focus: "landlord-ownership-update",
        matchAny: ["ownership update", "generate ownership update", "property update"],
        toolCalls: [{ tool: "generateClientSummary", input: { focus: "landlord-ownership-update" } }],
      },
      {
        id: "landlord-downtime-exposure",
        resolvedIntent: "landlord-downtime-exposure",
        focus: "landlord-downtime-exposure",
        matchAny: ["downtime exposure", "most exposed to downtime", "vacancy risk"],
        toolCalls: [{ tool: "generateClientSummary", input: { focus: "landlord-downtime-exposure" } }],
      },
    ],
  },
  reminders: {
    expirationMonths: [18, 12, 9, 6, 3],
    noticeDaysBefore: [180, 120, 90, 60, 30],
    overdueFollowUpDays: [21, 30, 45],
    staleListingDays: 45,
    staleProposalDays: 14,
  },
  templates: [
    {
      id: "crm_template_prospecting_follow_up",
      name: "Tour Follow Up",
      templateType: "tour_follow_up",
      subjectTemplate: "Follow up on {{building_name}} availability for {{company_name}}",
      bodyTemplate: "Hi {{prospect_name}},\n\nThank you for touring {{building_name}} {{suite}} in {{submarket}}. Based on your timing and occupancy goals, I wanted to keep the conversation moving and outline next steps.\n\nWould it be helpful if I summarized current proposal options and availability for you?\n\nBest,\n{{broker_name}}",
      variables: ["prospect_name", "company_name", "building_name", "suite", "submarket", "broker_name"],
      aiAssistEnabled: true,
    },
    {
      id: "crm_template_renewal_checkin",
      name: "Renewal Check In",
      templateType: "renewal_follow_up",
      subjectTemplate: "Renewal planning for {{company_name}} at {{building_name}}",
      bodyTemplate: "Hi {{client_name}},\n\nWith {{lease_expiration}} approaching, I wanted to help you get in front of the next decision window at {{building_name}} {{suite}}. We can review renewal leverage, relocation alternatives, and notice timing so nothing is rushed.\n\nIf helpful, I can also prepare a comparison of your current position versus market options in {{market}}.\n\nBest,\n{{broker_name}}",
      variables: ["client_name", "company_name", "lease_expiration", "building_name", "suite", "market", "broker_name"],
      aiAssistEnabled: true,
    },
    {
      id: "crm_template_proposal_follow_up",
      name: "Proposal Follow Up",
      templateType: "proposal_follow_up",
      subjectTemplate: "Next steps on the proposal for {{company_name}}",
      bodyTemplate: "Hi {{company_name}},\n\nI wanted to follow up on the proposal and outline the decisions that would keep timing on track. I can summarize economics, open issues, and timing considerations before the next round.\n\nPlease let me know if you would like a marked-up summary or a quick call.\n\nBest,\n{{broker_name}}",
      variables: ["company_name", "broker_name"],
      aiAssistEnabled: true,
    },
    {
      id: "crm_template_landlord_outreach",
      name: "Landlord Pipeline Update",
      templateType: "landlord_outreach",
      subjectTemplate: "Portfolio update for {{building_name}}",
      bodyTemplate: "Hi {{client_name}},\n\nHere is the current activity update for {{building_name}} in {{market}}: expiring tenants, open availabilities, proposal activity, and suites that may need proactive renewal outreach.\n\nI can send a building-by-building summary if that is helpful.\n\nBest,\n{{broker_name}}",
      variables: ["client_name", "company_name", "building_name", "market", "broker_name"],
      aiAssistEnabled: true,
    },
  ],
  exports: {
    excelDescriptor: "Landlord Report",
    pdfDescriptor: "Listing Pipeline Report",
    summary: "Availability status, proposal pipeline, suite expirations, and ownership-facing reporting.",
  },
  docs: {
    docsSummary: "Landlord mode centers buildings, suites, availabilities, tours, proposals, expirations, and ownership reporting on one shared graph.",
    securitySummary: "Landlord mode changes leasing-console behavior and reporting emphasis only; shared security and client boundaries remain unchanged.",
    contactSummary: "For landlord-side issues, include the building, suite, and leasing-console workflow affected.",
  },
};

export const REPRESENTATION_MODE_PROFILES: Record<RepresentationMode, RepresentationModeProfile> = {
  tenant_rep: TENANT_PROFILE,
  landlord_rep: LANDLORD_PROFILE,
};

export function getRepresentationModeProfile(
  mode: RepresentationMode | null | undefined,
): RepresentationModeProfile {
  return REPRESENTATION_MODE_PROFILES[mode || DEFAULT_REPRESENTATION_MODE];
}
