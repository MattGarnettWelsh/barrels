/*jslint node: true */
"use strict";

/**
 * Barrels: Simple fixtures for Sails.js
 */

/**
 * Dependencies
 */
var fs = require("fs");
var path = require("path");
var async = require("async");
var _ = require("lodash");

module.exports = Barrels;

/**
 * Barrels module
 * @param {string} sourceFolder defaults to <project root>/test/fixtures
 */
function Barrels(sourceFolder) {
    if (!(this instanceof Barrels)) return new Barrels(sourceFolder);

    // Fixture objects loaded from the JSON files
    this.data = {};

    // Map fixture positions in JSON files to the real DB IDs
    this.idMap = {};

    // The list of associations by model
    this.associations = {};

    // Load the fixtures
    sourceFolder = sourceFolder || process.cwd() + "/test/fixtures";
    var files = fs.readdirSync(sourceFolder);

    for (var i = 0; i < files.length; i++) {
        if (
            [".json", ".js"].indexOf(path.extname(files[i]).toLowerCase()) !==
            -1
        ) {
            var modelName = path
                .basename(files[i])
                .split(".")[0]
                .toLowerCase();
            this.data[modelName] = require(path.join(sourceFolder, files[i]));
        }
    }

    // The list of the fixtures model names
    this.modelNames = Object.keys(this.data);
}

/**
 * Add associations
 * @param {function} done callback
 */
Barrels.prototype.associate = function(collections, done) {
    if (!_.isArray(collections)) {
        done = collections;
        collections = this.modelNames;
    }

    var that = this;

    // Add associations whenever needed
    async.each(
        collections,
        function(modelName, nextModel) {
            var Model = sails.models[modelName];
            if (Model) {
                var fixtureObjects = _.cloneDeep(that.data[modelName]);
                async.each(
                    fixtureObjects,
                    function(item, nextItem) {
                        // Item position in the file
                        var itemIndex = fixtureObjects.indexOf(item);

                        // Find and associate
                        Model.findOne(that.idMap[modelName][itemIndex]).exec(
                            function(err, model) {
                                if (err) return nextItem(err);

                                // Pick associations only
                                item = _.pick(
                                    item,
                                    Object.keys(that.associations[modelName])
                                );
                                async.each(
                                    Object.keys(item),
                                    function(attr, nextAttr) {
                                        var association =
                                            that.associations[modelName][attr];
                                        // Required associations should have beed added earlier
                                        if (association.required)
                                            return nextAttr();
                                        var joined =
                                            association[association.type];

                                        if (!_.isArray(item[attr]))
                                            model[attr] =
                                                that.idMap[joined][
                                                    item[attr] - 1
                                                ];
                                        else {
                                            for (
                                                var j = 0;
                                                j < item[attr].length;
                                                j++
                                            ) {
                                                model[attr].add(
                                                    that.idMap[joined][
                                                        item[attr][j] - 1
                                                    ]
                                                );
                                            }
                                        }

                                        model.save(function(err) {
                                            if (err) return nextAttr(err);

                                            nextAttr();
                                        });
                                    },
                                    nextItem
                                );
                            }
                        );
                    },
                    nextModel
                );
            } else {
                nextModel();
            }
        },
        done
    );
};

/**
 * Put loaded fixtures in the database, associations excluded
 * @param {array} collections optional list of collections to populate
 * @param {function} done callback
 * @param {boolean} autoAssociations automatically associate based on the order in the fixture files
 */
Barrels.prototype.populate = async function(
    collections,
    done,
    autoAssociations
) {
    console.log("[Barrels] Collections");
    console.log(collections);

    if (!_.isArray(collections)) {
        autoAssociations = done;
        done = collections;
        collections = this.modelNames;
    } else {
        collections = _.map(collections, function(collection) {
            return collection.toLowerCase();
        });
    }
    autoAssociations = !(autoAssociations === false);
    var that = this;
    var proceed = true;

    for (let l = 0; l < collections.length; l++) {
        const modelName = collections[l];

        var Model = sails.models[modelName];
        if (Model && proceed) {
            try {
                console.log(`[Barrels] Deleting ${modelName} from database...`);
                // Cleanup existing data in the table / collection
                await Model.destroy({});

                // Save model's association information
                that.associations[modelName] = {};

                for (var i = 0; i < Model.associations.length; i++) {
                    var alias = Model.associations[i].alias;
                    that.associations[modelName][alias] = Model.associations[i];
                    // that.associations[modelName][alias].required = !!Model
                    //     ._validator.validations[alias].required;
                }
            } catch (err) {
                console.log("[Barrels] Error when deleting records...");
                console.log(err);
                return nextModel(err);
            }

            // Insert all the fixture items
            that.idMap[modelName] = [];

            var fixtureObjects = _.cloneDeep(that.data[modelName]);

            if (!_.isArray(fixtureObjects)) {
                throw "You're missing a file for this model or you have not defined a valid array";
            }
            if (_.isArray(fixtureObjects) && fixtureObjects.length <= 0) {
                throw "You have an empty array defined for this model";
            }

            for (let i = 0; i < fixtureObjects.length; i++) {
                var item = fixtureObjects[i];

                // Deal with associations
                for (var alias in that.associations[modelName]) {
                    if (that.associations[modelName][alias].required) {
                        // With required associations present, the associated fixtures
                        // must be already loaded, so we can map the ids
                        var collectionName =
                            that.associations[modelName][alias].collection; // many-to-many
                        var associatedModelName =
                            that.associations[modelName][alias].model; // one-to-many

                        if (_.isArray(item[alias]) && collectionName) {
                            if (!that.idMap[collectionName]) {
                                throw "Please provide a loading order acceptable for required associations";
                            }
                            for (var j = 0; j < item[alias].length; j++) {
                                item[alias][j] =
                                    that.idMap[collectionName][
                                        item[alias][j] - 1
                                    ];
                            }
                        } else if (associatedModelName) {
                            if (!that.idMap[associatedModelName]) {
                                throw "Please provide a loading order acceptable for required associations";
                            }
                            item[alias] =
                                that.idMap[associatedModelName][
                                    item[alias] - 1
                                ];
                        }
                    }
                }

                try {
                    // Insert
                    let model = await Model.create(item);
                    if (i === fixtureObjects.length - 1) {
                        console.log(
                            `[Barrels] Seeded ${modelName} in database...`
                        );
                    }
                    // Primary key mapping
                    that.idMap[modelName][i] = model[Model.primaryKey];
                } catch (err) {
                    proceed = false;
                    console.log("[Barrels] Error when inserting record...");
                    console.log(err);
                    break;
                }
            }
        }
    }

    // Create associations if requested
    if (autoAssociations) return that.associate(collections, done);

    done();
};
