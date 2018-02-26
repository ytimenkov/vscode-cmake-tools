import { } from "Fixture";
import { Model } from "../src/model";

suite('Model tests', function () {
    test.only('Instantiate model', function () {
        const model = new Model;
        model.state = 'Test';
    });
});