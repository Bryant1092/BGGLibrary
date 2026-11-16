import { Game } from "./game.model"

export interface GameList {
    name?: string
    gameList?: Game[]
    /** uid of the person who created it (missing on lists made before friends existed). */
    owner?: string
    /** "Friends can see": the owner's friends can view it and it counts in Friends' picks. */
    visible?: boolean
}
