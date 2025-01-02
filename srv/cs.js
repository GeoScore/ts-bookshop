const cds = require("@sap/cds");
const JSZip = require("jszip");
const fs = require("fs").promises;
const axios = require("axios");
const crypto = require("crypto");

/**
 * Class representing the administrative services for handling operations such as generating OnePager based on employee details and fetching employee names.
 */
class ManagerService extends cds.ApplicationService {
    /**
     * Initializes the service by registering event handlers for service operations.
     */
    async init() {
        /**
         * Event handler for generating OnePager.
         */
        this.on("generateOP", this.handleGenerateOP);

        /**
         * Handler for expiring certificates
         */
        this.on("getDaysUntilCertificateExpire", this.handleGetDaysUntilCertificateExpire);

        /**
         * Handler for expiring contracts
         */
        this.on("getDaysUntilContractExpire", this.handleGetDaysUntilContractExpire);

        /**
         * Event handler for retvieving certification list
         */
        this.on("updateSAPCertifications", this.handleUpdateSAPCertifications);

        const { Employees, Avatars } = this.entities;

        this.after("CREATE", Employees, async (req) => {
            const { ID } = req;
            await INSERT({ employee_ID: ID }).into(Avatars);
        });

        /**
         * Event handler for generating feedback e-mail for employee from project manager
         */
        this.on("getEmailContent", this.readEmailFile);

        this.on("getEmailCertificateContent", this.handleGetEmailCertificateContent);

        this.on("getEmailContractContent", this.handleGetEmailContractContent);

        await super.init();
    }

    /**
     * Handles the retrieval of certification list from a specified URL. This function fetches the certification data,
     * constructs a set of unique identifiers to ensure that each certification is represented only once,
     * and returns an array of certification objects with titles and codes.
     * @param {object} oReq - The request object provided by CAP framework which contains methods and properties to handle the request.
     * @returns {Promise<Array<{title: string, code: string}>>} - A promise that resolves to an array of objects, each containing a title and a code of the certification.
     */
    async handleUpdateSAPCertifications(oReq) {
        const sUrl = `https://learning.sap.com/service/learning/search/getCards(types%3D'%5B%22certification%22%5D'%2Cfilters%3D'%7B%7D'%2Climit%3D100%2Cpage%3D1)`;
        let aCertificates = [];
        try {
            const oResponse = await axios.get(sUrl);
            aCertificates = oResponse.data.value.results;
        } catch (oError) {
            cds.error("Can not get certificates from " + sUrl, { moreInfo: oError.message });
        }

        const { Certifications } = this.entities;

        const aCerts = Array.from(aCertificates).map((oCert) => {
            //? Roles property can be object with roles property, array or stringified array
            const sRoles = Array.isArray(oCert.roles)
                ? oCert.roles
                : JSON.parse(oCert.roles).map((oRole) => oRole.roles);
            return {
                code: oCert.objId || cds.error(`Expected 'code' not to be null`),
                name: oCert.title,
                level: oCert.level,
                roles: this._capitalizeFirstLetters(sRoles.join(", ").replace(/_/g, " ")),
                description: oCert.description,
                type: this._capitalizeFirstLetters(oCert.objType)
            };
        });
        let aRes;
        try {
            aRes = await UPSERT.into(Certifications).entries(aCerts);
        } catch (oError) {
            cds.error("Can not update certificates!", { moreInfo: oError.message });
        }
        return oReq.info(200, `Certificates update success. Entries synced : ${aRes}`);
    }

    /**
     * Capitalizes every first letter in string with multiple words
     * @param sString - String to capitalize
     * @returns {string} - String with each first letter capitalized
     */
    _capitalizeFirstLetters(sString) {
        const sCapitalized = sString
            .split(" ")
            .map((sWord) => {
                return sWord.charAt(0).toUpperCase() + sWord.slice(1);
            })
            .join(" ");
        return sCapitalized !== "" ? sCapitalized : "N/A";
    }

    /**
     * Generates a key using a seed for hashing.
     * @param {string} seed
     * @returns {Buffer}
     */
    _generateKey(seed) {
        return crypto.createHash("sha256").update(seed).digest();
    }

    /**
     * Encrypts data using AES-256-CBC encryption.
     * @param {string} data
     * @param {string} seed
     * @returns {string}
     */
    _encrypt(data, seed) {
        const key = this._generateKey(seed);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
        let encrypted = cipher.update(data, "utf8", "hex");
        encrypted += cipher.final("hex");
        return `${iv.toString("hex")}:${encrypted}`;
    }

    /**
     * Decrypts data using AES-256-CBC encryption.
     * @param {string} hashedData
     * @param {string} seed
     * @returns {string}
     */
    _decrypt(hashedData, seed) {
        const key = this._generateKey(seed);
        const [ivHex, encrypted] = hashedData.split(":");
        const iv = Buffer.from(ivHex, "hex");
        const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
        let decrypted = decipher.update(encrypted, "hex", "utf8");
        decrypted += decipher.final("utf8");
        return decrypted;
    }

    /**
     * Handles the request to generate a OnePager for an employee, based on their ID.
     * @param oReq - The request object containing user data and type of OnePager.
     */
    async handleGenerateOP(oReq) {
        try {
            const aEmployeeIDs =
                oReq.data.aEmployeeIDs || cds.error(`There are no valid Employee ID array`, { code: 400 });
            const aPPTBuffers = [];
            for (const EmployeeID of aEmployeeIDs) {
                const oEmployeeDetails =
                    (await this.fetchEmployeeDetails(EmployeeID)) ||
                    cds.error(`There are no Employee with ID: ${EmployeeID}`, { code: 404 });
                oEmployeeDetails.projects.sort((a, b) => new Date(b.project.startDate) - new Date(a.project.startDate));

                const bIsExternal = oReq.data.sType === "external";
                if (bIsExternal) {
                    oEmployeeDetails.fullName = "Capgemini Employee";
                }

                const oPlaceholders = this.extractPlaceholders(oEmployeeDetails);
                const aModifiedPPT = await this.generateModifiedPPT(oPlaceholders, EmployeeID, bIsExternal);
                aPPTBuffers.push(aModifiedPPT);
            }

            await this.sendOnePagerResponse(oReq, aPPTBuffers, aEmployeeIDs);
        } catch (oError) {
            cds.error(`Error while generating OnePager! ` + oError.message, { code: oError.code });
        }
    }

    /**
     * Fetches detailed information of an employee including skills, certifications, and projects.
     * @param aEmployeeIDs - The ID of the employee to fetch details for.
     * @returns {object} An object containing detailed employee information.
     */
    async fetchEmployeeDetails(aEmployeeIDs) {
        const { Employees } = this.entities;
        return SELECT.one
            .from(Employees, (e) => {
                e`.*`,
                    e.skills((s) => {
                        s`.*`, s.skill((sk) => sk`.*`);
                    }),
                    e.certifications((c) => {
                        c`.*`, c.certification((cr) => cr`.*`);
                    }),
                    e.projects((p) => {
                        p`.*`,
                            p.project((pd) => {
                                pd`.*`;
                            });
                    }),
                    e.avatar((a) => a`.*`),
                    e.languages((ls) => {
                        ls.language((l) => l`.*`);
                    });
            })
            .where({ ID: aEmployeeIDs });
    }

    /**
     * Fetches the avatar data as a buffer for a given employee ID.
     * This function queries the `Avatars` entity for the 'data' field based on the provided employee ID.
     * It returns the image data as a buffer, which can be useful for transmitting binary data over HTTP or storing it in a file system.
     * @param {string} sEmployee_ID - The employee ID to fetch the avatar for.
     * @returns {Promise<Buffer>} - A promise that resolves with the image data as a buffer.
     * @throws {Error} - Throws an error if no data is found for the given employee ID or if there are issues accessing the data.
     */
    async fetchAvatarBuffer(sEmployee_ID) {
        const { Avatars } = this.entities;

        // Execute a query on the Avatars entity

        const oResult = await SELECT(["data"]).from(Avatars).where({ employee_ID: sEmployee_ID });
        // Check if the result is valid and contains the expected data
        if (!oResult[0].data) {
            return null;
        }

        // Collect data chunks
        const aChunks = [];
        return new Promise((resolve, reject) => {
            oResult[0].data.on("data", (chunk) => aChunks.push(chunk));
            oResult[0].data.on("end", () => {
                const aBuffer = Buffer.concat(aChunks);
                resolve(aBuffer); // Return the buffer instead of responding to an HTTP request
            });
            oResult[0].data.on("error", (err) => {
                reject(err);
            });
        });
    }

    /**
     * Extracts placeholders for OnePager template replacement based on employee details.
     * @param oDetails - The employee details containing name, certifications, and project roles.
     * @returns {object} An object with key-value pairs for placeholders and their replacements.
     */
    extractPlaceholders(oDetails) {
        const oPlaceholders = {
            "{{fullName}}": oDetails.fullName || ""
        };

        //TODO fetching main role from contract entity (fullstack, SAP CPI DEV, etc. waiting to be added to contract entity )

        for (let i = 0; i < 2; i++) {
            oPlaceholders[`{{since${i}}}`] = (oDetails.certifications[i] && oDetails.certifications[i].validFrom) || "";
            oPlaceholders[`{{competence${i}}}`] =
                (oDetails.certifications[i] && oDetails.certifications[i].certification.name) || "";
        }

        //TODO add key competences for example (Cloud Platform Integration/Process Integration/SAP CAP)

        for (let i = 0; i < 4; i++) {
            if (oDetails.projects[i]) {
                oPlaceholders[`{{projectRole${i}}}`] = oDetails.projects[i].role_code || "";
                oPlaceholders[`{{projectIndustry${i}}}`] = oDetails.projects[i].project.domain_code || "";
                oPlaceholders[`{{projectName${i}}}`] = oDetails.projects[i].project.name || "";
                //TODO add Responsibilities (we should add it in project entity or somewhere else)
            }
        }
        if (oDetails.languages) {
            oPlaceholders[`{{languages}}`] = oDetails.languages.map((lang) => lang.language.description).join(", ");
        }
        if (oDetails.skills) {
            oPlaceholders[`{{skills}}`] = oDetails.skills.map((s) => s.skill.name).join("\n");
        }

        return oPlaceholders;
    }

    /**
     * Generates a modified OnePager PowerPoint presentation by replacing placeholders in the template with actual data.
     * @param oPlaceholders - The placeholders and their corresponding data to be replaced in the template.
     * @param sEmployee_ID
     * @param bIsExternal
     * @returns {Promise<Buffer>} A promise that resolves to the binary content of the modified PowerPoint.
     */
    async generateModifiedPPT(oPlaceholders, sEmployee_ID, bIsExternal) {
        const sFilePath = "./srv/res/opTemplate/OP_template.pptx";
        const aTemplateBuffer = await fs.readFile(sFilePath);
        const oZip = await JSZip.loadAsync(aTemplateBuffer);

        if (!bIsExternal) {
            const aAvatarBuffer = await this.fetchAvatarBuffer(sEmployee_ID);
            if (aAvatarBuffer) {
                oZip.file("ppt/media/image23.png", aAvatarBuffer);
            }
        }

        await this.updateSlides(oZip, oPlaceholders);
        return oZip.generateAsync({ type: "nodebuffer" });
    }

    /**
     * Updates slides within a PowerPoint presentation, replacing placeholders with actual data.
     * @param oZip - The JSZip instance containing the PowerPoint files.
     * @param placeholders - An object containing placeholders and their replacements.
     */
    async updateSlides(oZip, placeholders) {
        const aSlideFiles = Object.keys(oZip.files).filter((fn) => fn.includes("ppt/slides/slide"));
        for (let sFileName of aSlideFiles) {
            let sFileData = await oZip.file(sFileName).async("string");
            let sUpdatedFileData = Object.keys(placeholders).reduce(
                (sContent, sPlaceholder) => sContent.replace(new RegExp(sPlaceholder, "g"), placeholders[sPlaceholder]),
                sFileData
            );
            oZip.file(sFileName, sUpdatedFileData);
        }
    }

    /**
     * Sends the modified OnePager as a response to the client.
     * @param oReq - The request object.
     * @param aPPTBuffer - The binary content of the modified PowerPoint presentation.
     * @param aPPTBuffers
     * @param aEmployeeIDs
     */
    async sendOnePagerResponse(oReq, aPPTBuffers, aEmployeeIDs) {
        try {
            if (aPPTBuffers.length > 1) {
                const zip = new JSZip();
                aPPTBuffers.forEach((buffer, index) => {
                    const filename = `OP_${aEmployeeIDs[index]}.pptx`;
                    zip.file(filename, buffer);
                });

                const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

                oReq.res.type("application/zip");
                oReq.res.setHeader("Content-Disposition", 'attachment; filename="OnePagers.zip"');
                oReq.res.send(zipBuffer);
            } else {
                oReq.res.type("application/vnd.openxmlformats-officedocument.presentationml.presentation");
                oReq.res.setHeader("Content-Disposition", `attachment; filename="OP_${aEmployeeIDs[0]}.pptx"`);
                oReq.res.send(aPPTBuffers[0]);
            }
        } catch (oError) {
            cds.error(`Problem with sending response!`, { moreInfo: oError.message });
        }
    }

    /**
     * Return array of objects which contains employee full name, certificate name , employee email, days left to certificate expire from current date AND VALIDdATE
     * @param oReq Request
     * @returns {Array of certificateionExpiredList} type defined in manager-service.cds
     */
    async handleGetDaysUntilCertificateExpire() {
        const { Employees, EmployeeCertifications, Certifications } = this.entities;
        try {
            const aResults = await SELECT.from(`${Employees.name} as E`)
                .columns(
                    "E.ID as empID",
                    "E.fullName",
                    "EC.validTo as expirationDate",
                    "C.code as certID",
                    "C.name as certificateName",
                    "E.email",
                    "EC.validTo as daysLeft"
                )
                .leftJoin(`${EmployeeCertifications.name} as EC`)
                .on(`E.ID = EC.employee_ID`)
                .leftJoin(`${Certifications.name} as C`)
                .on(`C.code = EC.certification_code`)
                .where(`validTo is not null`);
            const dCurrentDate = new Date().getTime();
            aResults.map(
                (oResult) =>
                    (oResult.daysLeft = Math.round(
                        (new Date(oResult.daysLeft).getTime() - dCurrentDate) / (24 * 60 ** 2 * 1000) //convert timestamp to days
                    ))
            );
            return aResults;
        } catch (oError) {
            cds.error(`Error while getting Certificates!`, { moreInfo: oError.message });
        }
    }

    /**
     * Return array of objects which contains employee full name, contract name , employee email, days left to contract expire from current date AND VALIDdATE
     * @param {*} oReq Request
     * @returns {contractExpiredList} type defined in manager-service.cds
     */
    async handleGetDaysUntilContractExpire() {
        const { Employees, Contracts } = this.entities;
        try {
            const aResults = await SELECT.from(`${Contracts.name} as C`)
                .columns(
                    "C.ID as contractID",
                    "C.employee_ID as empID",
                    "C.endDate as expirationDate",
                    "C.endDate as daysLeft",
                    "C.typeOfContract as contractType",
                    "C.contractNumber as contractNumber",
                    "E.fullName",
                    "E.email"
                )
                .leftJoin(`${Employees.name} as E`)
                .on("E.ID = C.employee_ID")
                .where("endDate is not null");
            const dCurrentDate = new Date().getTime();
            aResults.map(
                (oResult) =>
                    (oResult.daysLeft = Math.round(
                        (new Date(oResult.daysLeft).getTime() - dCurrentDate) / (24 * 60 ** 2 * 1000) //convert timestamp to days
                    ))
            );
            return aResults;
        } catch (oError) {
            cds.error(`Error while getting Contracts!`, { moreInfo: oError.message });
        }
    }

    /**
     * Reads feedback e-mail message from a file
     * @param req
     * @params req The request object with details of feedback request
     * @returns {string} The content of feedback e-mail.
     */
    async readEmailFile(req) {
        const sFilePath = "./srv/res/emails/projectManagerTemplate.txt";
        const sProjectManager =
            req.data.projectManager || cds.error(`There is no project manager name!`, { code: 400 });
        const sEmployeeName = req.data.employeeName || cds.error(`There is no employee name!`, { code: 400 });
        const sProjectName = req.data.projectName || cds.error(`There is no project name!`, { code: 400 });
        let sEmailText;

        try {
            sEmailText = await fs.readFile(sFilePath, "utf8", (oError, data) => {
                if (oError) cds.error(oError.message);
                else return data;
            });
        } catch (oError) {
            cds.error(`Error while reading file with template!`, { moreInfo: oError.message });
        }

        sEmailText = sEmailText
            .replace("#projectManager#", sProjectManager)
            .replaceAll("#employeeName#", sEmployeeName)
            .replace("#projectName#", sProjectName);
        return sEmailText;
    }

    /**
     * Create Subject and Body for e-mail based on contract days until expiration date
     * @param {Request} req Request parameters as employeeName, noDays and others data as requestor role, request timestamp etc.
     * @typedef {object} Object with property body and subject
     * @property {string} Body Set value depends on asNoDays value, read and set text from txt file in db/emails
     * @property {string} Subject Depends on how many days until end validity () and set value to  Contract expired or Contract soon expire
     * @returns {object}  with property Body and Subject which's incluides into e-mail trigger in UI
     */
    async handleGetEmailContractContent(req) {
        const oData = req.data;
        const sName = oData.employeeName || cds.error(`There is no employee name!`, { code: 400 });
        const sNoDays = oData.noDays || cds.error(`There is no number of days!`, { code: 400 });
        const bNoDaysLessThanOne = sNoDays === "Expired" || sNoDays < 1 ? true : false;
        const sSubPath = bNoDaysLessThanOne ? "expiringContractTemplate.txt" : "expiringContractSoonTemplate.txt";
        const sSubject = bNoDaysLessThanOne ? "Contract expired" : "Contract soon expire";
        const sPath = `./srv/res/emails/${sSubPath}`;
        let sEmailText;

        try {
            sEmailText = await fs.readFile(sPath, "utf8", (oError, data) => {
                if (oError) cds.error(oError.message);
                else return data;
            });
        } catch (oError) {
            cds.error(`Error while reading file with template!`, { moreInfo: oError.message });
        }

        return {
            Subject: sSubject,
            Body: bNoDaysLessThanOne
                ? sEmailText.replace("#employee#", sName)
                : sEmailText.replace("#employee#", sName).replace("#noDays#", sNoDays)
        };
    }

    /**
     * Create Subject and Body for e-mail based on certificate days until expiration date
     * @param {Request} req Request parameters as employeeName, noDays, certificateName and others data as requestor role, request timestamp etc.
     * @typedef {object} Object with property body and subject
     * @property {string} Body Set value depends on asNoDays value, reading and setting text from txt file in db/emails
     * @property {string} Subject Depends on how many days until end validity () and set value to  Certificate expired or Certificate soon expire
     * @returns {object}  with property Body and Subject which's incluides into e-mail trigger in UI
     */
    async handleGetEmailCertificateContent(req) {
        const oData = req.data;
        const sName = oData.employeeName || cds.error(`There is no employee name!`, { code: 400 });
        const sNoDays = oData.noDays || cds.error(`There is no number of days!`, { code: 400 });
        const sProjectName = oData.certificateName || cds.error(`There is no cert!`, { code: 400 });
        const bNoDaysLessThanOne = sNoDays === "Expired" || sNoDays < 1 ? true : false;
        const sSubPath = bNoDaysLessThanOne ? "expiringCertificateTemplate.txt" : "expiringCertificateSoonTemplate.txt";
        const sSubject = bNoDaysLessThanOne ? "Certificate expired" : "Certificate soon expire";
        const sPath = `./srv/res/emails/${sSubPath}`;
        let sEmailText;

        try {
            sEmailText = await fs.readFile(sPath, "utf8", (oError, data) => {
                if (oError) cds.error(oError.message);
                else return data;
            });
        } catch (oError) {
            cds.error(`Error while reading file with template!`, { moreInfo: oError.message });
        }

        return {
            Subject: sSubject,
            Body: bNoDaysLessThanOne
                ? sEmailText.replace("#employee#", sName).replace("#certName#", sProjectName)
                : sEmailText
                      .replace("#employee#", sName)
                      .replace("#certName#", sProjectName)
                      .replace("#noDays#", sNoDays)
        };
    }
}

module.exports = ManagerService;