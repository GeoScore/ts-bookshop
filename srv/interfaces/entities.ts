import { Currency } from "#cds-models/CatalogService";

export interface Book {
    ID          : Number,
    title       : String,
    descr       : String,
    author      : Author,
    stock       : Number,
    price       : Number,
    currency    : Currency,
}

export interface Author {
    ID      : Number,
    name    : String,
    books   : Book[]
}

export type AuthorIDName = {
    ID      : Number,
    name    : String,
}

