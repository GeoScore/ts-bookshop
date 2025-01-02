import cds from '@sap/cds';
import { Request, Service } from '@sap/cds';
import { Author, Book } from '#cds-models/CatalogService';

class CatalogService extends cds.ApplicationService {
        async init() {
        
        this.on("getAuthorByID", this.fnGeyAuthorByID);

        await super.init();
    }

    async fnGeyAuthorByID(oRequest: Request) : Promise<string> {
        const { Authors } = this.entities;
        const sAuthorID = oRequest.data.authorID;
        if (!sAuthorID){
            throw new Error('ID not found')
        }
        let aResult:any[];
        try{
            aResult = await SELECT
                .from(`${Authors.name} as A`)
                .columns('A.ID as ID', 'A.name as name')
                .where({ID : sAuthorID});
            if(!aResult) {
                throw new Error('Authopr not found');
            }
            return aResult[0].name;
        }
        catch(oError : unknown){
            console.error(`Something went wrong ...\n`, oError);
            throw new Error(`Error: ${oError}`);
        }
    }
}

module.exports = CatalogService;