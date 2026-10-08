CREATE TABLE "blueprints"(
    "id" BIGINT NOT NULL,
    "model" BIGINT NOT NULL,
    "column" BIGINT NOT NULL,
    "brand" BIGINT NOT NULL
);
ALTER TABLE
    "blueprints" ADD PRIMARY KEY("id");
CREATE TABLE "variants"(
    "blueprint_id" BIGINT NOT NULL,
    "provider_id" BIGINT NOT NULL,
    "variant_id" BIGINT NOT NULL,
    "variant_cost" BIGINT NOT NULL,
    "shipping_option_1_first_item" BIGINT NOT NULL,
    "shipping_option_1_add_item" BIGINT NOT NULL,
    "shipping_option_1_handling_time" BIGINT NOT NULL,
    "shipping_option_1_countrties" BIGINT NOT NULL
);
CREATE TABLE "providers"("id" BIGINT NOT NULL);
ALTER TABLE
    "providers" ADD PRIMARY KEY("id");
CREATE TABLE "variant_details"(
    "id" BIGINT NOT NULL,
    "size" BIGINT NOT NULL,
    "title" BIGINT NOT NULL,
    "placeholder_1_position" BIGINT NOT NULL,
    "placeholder_1_width" BIGINT NOT NULL,
    "placeholder_1_height" BIGINT NOT NULL,
    "placeholder_2_position" BIGINT NOT NULL,
    "placeholder_2_width" BIGINT NOT NULL,
    "placeholder_2_height" BIGINT NOT NULL,
    "placeholder_3_position" BIGINT NOT NULL,
    "placeholder_3_width" BIGINT NOT NULL,
    "placeholder_3_height" BIGINT NOT NULL,
    "placeholder_4_position" BIGINT NOT NULL,
    "placeholder_4_width" BIGINT NOT NULL,
    "placeholder_4_height" BIGINT NOT NULL,
    "placeholder_5_position" BIGINT NOT NULL,
    "placeholder_5_width" BIGINT NOT NULL,
    "placeholder_5_height" BIGINT NOT NULL
);
ALTER TABLE
    "variant_details" ADD PRIMARY KEY("id");
ALTER TABLE
    "variants" ADD CONSTRAINT "variants_provider_id_foreign" FOREIGN KEY("provider_id") REFERENCES "providers"("id");
ALTER TABLE
    "variants" ADD CONSTRAINT "variants_blueprint_id_foreign" FOREIGN KEY("blueprint_id") REFERENCES "blueprints"("id");
ALTER TABLE
    "variants" ADD CONSTRAINT "variants_variant_id_foreign" FOREIGN KEY("variant_id") REFERENCES "variant_details"("id");