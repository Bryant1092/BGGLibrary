import { Game } from "./game.model"

export interface GameList {
    name?: string
    gameList?: Game[]
    /** uid of the person who created it (missing on lists made before friends existed). */
    owner?: string
    /** "Friends can see": the owner's friends can view it and it counts in Friends' picks. */
    visible?: boolean
    /**
     * Games the group has played on this list, kept even after one is removed from the
     * list (asked 2026-11-19: a history of what you've played). Unticking Played removes
     * it (treated as a mistake). Shown in the list's collapsed "Played" section.
     */
    playedHistory?: PlayedGame[]
}

/** A history entry: the game as it was on the list, and when Played was ticked. */
export interface PlayedGame extends Game {
    playedAt?: number
}
