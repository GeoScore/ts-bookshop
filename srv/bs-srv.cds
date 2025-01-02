using { cap_typescript as cts } from '../db/schema';

service CatalogService @(path:'/browse') {
    entity Books as projection on cts.Books;
    entity Genres as projection on cts.Genres;
    entity Authors as projection on cts.Authors;

    action submitOrder (BookID: String, amount: Integer);
    function getAuthorByID(authorID: Integer) returns String;
}