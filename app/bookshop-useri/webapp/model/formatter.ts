export default {
    shortAuthorName : function(sFullname : string) : string {
        return `${sFullname.slice(1, sFullname.indexOf(" ")).toUpperCase()[0]}.${sFullname.slice(sFullname.indexOf(" "))}`;
    }
};