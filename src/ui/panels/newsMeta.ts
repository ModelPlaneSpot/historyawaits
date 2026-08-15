import type { NewsCategory, NewsImportance } from '@/domain/schemas'

export const CATEGORY_ICONS: Record<NewsCategory, string> = {
  breaking: '📰',
  war: '⚔️',
  military: '🪖',
  diplomacy: '🤝',
  economy: '💰',
  politics: '🏛️',
  disaster: '🌪️',
  technology: '🔬',
  terrorism: '💥',
  civil_conflict: '🔥',
  international: '🌍',
  territorial: '🗺️',
  resources: '⛏️',
}

export const CATEGORY_LABELS: Record<NewsCategory, string> = {
  breaking: 'Breaking',
  war: 'Wars',
  military: 'Military',
  diplomacy: 'Diplomacy',
  economy: 'Economy',
  politics: 'Politics',
  disaster: 'Disasters',
  technology: 'Technology',
  terrorism: 'Terrorism',
  civil_conflict: 'Civil Conflicts',
  international: 'International',
  territorial: 'Territorial',
  resources: 'Resources',
}

export const IMPORTANCE_LABELS: Record<NewsImportance, string> = {
  minor: 'Minor',
  medium: 'Medium',
  major: 'Major',
  critical: 'Critical',
}

export const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS) as NewsCategory[]
