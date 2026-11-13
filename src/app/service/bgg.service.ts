import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BggItem } from '../model/bgg.model';

export interface SearchResult {
  result: {
    items: BggItem[];
	  paging: number;
  }
}

@Injectable({
  providedIn: 'root'
})
export class BggService {

  libraryUrl = 'https://tabletop.events/api/library/0AEB11DA-2B7D-11EC-B400-855F800FD618/librarygames';
  itemUrl = (id: string) => `https://tabletop.events/api/librarygame/${id}`;

  constructor(private http: HttpClient) { }

  // Note: `_include_options=1` was removed from both requests. It added the
  // list of allowed values for every field (~35% of each response) to every
  // game, and the app never reads `_options`.
  getBggLibraryInfo(query?: string, page = 1, pageSize = 10, orderBy = 'name', sortBy = 'asc') {
    const params = new HttpParams()
        .append('_include', 'bgg_icon_uri')
        .append('_items_per_page', pageSize)
        .append('_order_by', orderBy)
        .append('_page_number', page)
        .append('_sort_order', sortBy)
        .append('is_in_circulation', '1')
        .append('query', query || '');
    return this.http.get(this.libraryUrl, {params});
  }

  // Only the game's own fields are used. The related library object and
  // relationship links that were also requested made each response ~2.5x larger
  // (about 1.9 KB -> 0.76 KB), which adds up because the User page requests one per game.
  getBggGameInfo(id: string) {
    const params = new HttpParams()
        .append('_include', 'bgg_icon_uri');
    return this.http.get<BggItem>(this.itemUrl(id), {params});
  }
}