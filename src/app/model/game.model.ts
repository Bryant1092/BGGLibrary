export interface Game {
  bgg_id?: number
  name?: string
  photo?: string
  id?: string
  /** Ticked on the My Lists page. Stored on the shared list, so everyone on the list sees it. */
  played?: boolean
}
