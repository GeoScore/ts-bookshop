import { Currency } from "#cds-models/CatalogService";

interface Book {
    ID          : String,
    title       : String,
    descr       : String,
    author      : Author,
    stock       : Number,
    price       : Number,
    currency    : Currency,
}

interface Author {
    ID      : String,
    name    : String,
    books   : Book[]
}
