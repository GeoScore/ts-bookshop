import Controller from "sap/ui/core/mvc/Controller";
import MessageToast from "sap/m/MessageToast";
import formatter  from "../model/formatter";
/**
 * @namespace bui.bookshopuseri.controller
 */
export default class View extends Controller {
    public formatter = formatter;
    /*eslint-disable @typescript-eslint/no-empty-function*/
    public onInit(): void {

    }

    public onPressButton() : void {
        const sMessage  = "You clicked button Man.";
        MessageToast.show(sMessage);
    }

}