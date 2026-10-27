import { Module } from "@nestjs/common";
import { GatewayClient } from "./gateway.client.js";

@Module({
  providers: [GatewayClient],
  exports: [GatewayClient],
})
export class GatewayModule {}
