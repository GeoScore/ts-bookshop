using { cap_typescript as cts } from '../db/schema';

service CatalogService @(path:'/browse') {
    entity Books as projection on cts.Books;
    entity Genres as projection on cts.Genres;
    entity Authors as projection on cts.Authors;

    // view BookInfo as 
        // SELECT 
            // key B.ID,
            // B.title,
            // B.descr,
            // B.author,
            // A.name as authorName,
            // B.genre,
            // B.stock, 
            // B.price, 
            // B.currency
        // FROM Books as B
        // LEFT JOIN Authors as A
        // on A.ID = B.author;


    action submitOrder (BookID: String, amount: Integer);
    function getAuthorByID(authorID: Integer) returns String;
}