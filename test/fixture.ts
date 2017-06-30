
import { normalize, join } from "path";

const here = __dirname;

export class Fixture {
    static resolvePath(filename: string): string {
        return normalize(join(here, '../..', 'test', filename));
    }
}