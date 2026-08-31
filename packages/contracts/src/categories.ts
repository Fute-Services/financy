/**
 * The default spend category tree.
 *
 * Applied to an organisation when it is created (registration, task 1.3.2)
 * rather than by the system seed, because categories are tenant-scoped — there
 * is no organisation for the system seed to attach them to.
 *
 * Not specified in `docs/`, so this is a decision rather than a
 * transcription. Two properties drove it:
 *
 * - **Two levels, not one and not four.** One level forces "Travel" to absorb
 *   airfare and mileage, which have different policy treatment. Four is a
 *   chart of accounts, which is a different artefact with a different owner
 *   (Phase 6) — and a taxonomy nobody can hold in their head gets used wrong.
 * - **Categories a policy would plausibly branch on.** These are the
 *   dimensions the approval engine reasons over, so the split follows how
 *   spend is *controlled*, not how it is later *booked*.
 *
 * Seeded rows are marked `isSystem`, so an organisation may archive or extend
 * them and a later deploy will not resurrect or overwrite their own.
 */

export interface CategoryTemplate {
  readonly key: string;
  readonly name: string;
  readonly children?: readonly CategoryTemplate[];
}

export const DEFAULT_CATEGORIES: readonly CategoryTemplate[] = [
  {
    key: 'travel',
    name: 'Travel',
    children: [
      { key: 'travel_airfare', name: 'Airfare' },
      { key: 'travel_accommodation', name: 'Accommodation' },
      { key: 'travel_ground', name: 'Ground transport' },
      { key: 'travel_mileage', name: 'Mileage' },
    ],
  },
  {
    key: 'meals',
    name: 'Meals and entertainment',
    children: [
      { key: 'meals_team', name: 'Team meals' },
      { key: 'meals_client', name: 'Client entertainment' },
    ],
  },
  {
    key: 'software',
    name: 'Software and subscriptions',
    children: [
      { key: 'software_saas', name: 'SaaS subscriptions' },
      { key: 'software_licences', name: 'Licences' },
      { key: 'software_cloud', name: 'Cloud and hosting' },
    ],
  },
  {
    key: 'equipment',
    name: 'Hardware and equipment',
    children: [
      { key: 'equipment_computers', name: 'Computers' },
      { key: 'equipment_peripherals', name: 'Peripherals' },
      { key: 'equipment_furniture', name: 'Furniture' },
    ],
  },
  {
    key: 'professional_services',
    name: 'Professional services',
    children: [
      { key: 'professional_legal', name: 'Legal' },
      { key: 'professional_accounting', name: 'Accounting and audit' },
      { key: 'professional_consulting', name: 'Consulting' },
      { key: 'professional_recruiting', name: 'Recruiting' },
    ],
  },
  {
    key: 'marketing',
    name: 'Marketing',
    children: [
      { key: 'marketing_advertising', name: 'Advertising' },
      { key: 'marketing_events', name: 'Events and conferences' },
      { key: 'marketing_content', name: 'Content and design' },
    ],
  },
  {
    key: 'office',
    name: 'Office and facilities',
    children: [
      { key: 'office_rent', name: 'Rent' },
      { key: 'office_utilities', name: 'Utilities' },
      { key: 'office_supplies', name: 'Supplies' },
    ],
  },
  {
    key: 'people',
    name: 'People',
    children: [
      { key: 'people_training', name: 'Training and development' },
      { key: 'people_wellbeing', name: 'Wellbeing and benefits' },
    ],
  },
  { key: 'telecoms', name: 'Telecoms and internet' },
  { key: 'insurance', name: 'Insurance' },
  { key: 'taxes_fees', name: 'Taxes, duties, and bank fees' },
  {
    key: 'uncategorised',
    name: 'Uncategorised',
  },
];

/** The tree flattened to `(key, name, parentKey)`, in insertion order. */
export function flattenCategories(
  templates: readonly CategoryTemplate[] = DEFAULT_CATEGORIES,
  parentKey: string | null = null,
): Array<{ key: string; name: string; parentKey: string | null }> {
  return templates.flatMap((template) => [
    { key: template.key, name: template.name, parentKey },
    ...flattenCategories(template.children ?? [], template.key),
  ]);
}

/**
 * Where a transaction lands when nothing else matched.
 *
 * It exists as a real row rather than as a null category so that "nobody has
 * coded this yet" is a queryable state with a review queue behind it, instead
 * of an absence that every report has to remember to handle.
 */
export const UNCATEGORISED_CATEGORY_KEY = 'uncategorised';
