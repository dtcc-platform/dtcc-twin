import { Module } from "@nestjs/common";
import { PackageStorage } from "./package-storage.js";

@Module({
  providers: [PackageStorage],
  exports: [PackageStorage],
})
export class StorageModule {}
