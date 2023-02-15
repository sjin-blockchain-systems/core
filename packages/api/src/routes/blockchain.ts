import Hapi from "@hapi/hapi";
import Joi from "joi";

import { BlockchainController } from "../controllers/blockchain";

export const register = (server: Hapi.Server): void => {
    const controller = server.app.app.resolve(BlockchainController);
    server.bind(controller);

    server.route({
        method: "GET",
        path: "/blockchain",
        handler: (request: Hapi.Request, h: Hapi.ResponseToolkit) => controller.index(request, h),
    });

    server.route({
        method: "GET",
        path: "/blockchain/search",
        handler: (request: Hapi.Request, h: Hapi.ResponseToolkit) => controller.search(request, h),
        options: {
            validate: {
                query: Joi.object({
                    criteria: Joi.string()
                        .pattern(/^[a-zA-Z0-9!@$&_.]{1,66}$/)
                        .required(),
                }),
            },
        },
    });

    server.route({
        method: "GET",
        path: "/blockchain/search/{criteria}",
        handler: (request: Hapi.Request, h: Hapi.ResponseToolkit) => controller.search(request, h),
        options: {
            validate: {
                params: Joi.object({
                    criteria: Joi.string()
                        .pattern(/^[a-zA-Z0-9!@$&_.]{1,66}$/)
                        .required(),
                }),
            },
        },
    });
};
