import cds from '@sap/cds';
import { Request, Service } from '@sap/cds';
import { Author, Book } from '#cds-models/CatalogService';
import { AuthorIDName } from './interfaces/entities'

class CatalogService extends cds.ApplicationService {
        async init() {
        
        this.on("getAuthorByID", this.fnGeyAuthorByID);

        await super.init();
    }

    async fnGeyAuthorByID(oRequest: Request) : Promise<AuthorIDName> {
        const { Authors } = this.entities;
        const iAuthorID : Number = oRequest.data.authorID;
        if (!iAuthorID){
            throw new Error('ID not found');
        }
        let aResult: AuthorIDName[];
        try{
            aResult = await SELECT
                .from(`${Authors.name} as A`)
                .columns('A.ID as ID', 'A.name as name')
                .where({ID : iAuthorID});
        if(!aResult) {
                throw new Error('Author not found');
            }
            return aResult[0];
        }
        catch(oError : unknown){
            throw new Error(`Error: ${oError}`);
        }
    }
}

module.exports = CatalogService;