import type { StoryType, StoryStatus } from '@/domain/schemas'

export const STORY_TYPE_LABELS: Record<StoryType, string> = {
  war: 'War',
  civil_war: 'Civil War',
  economic_crisis: 'Economic Crisis',
  coup: 'Coup',
  election: 'Election',
  diplomatic_crisis: 'Diplomatic Crisis',
}

export const STORY_STATUS_LABELS: Record<StoryStatus, string> = {
  developing: 'Developing',
  active: 'Active',
  resolved: 'Resolved',
}
