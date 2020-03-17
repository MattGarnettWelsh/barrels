"use strict";

/**
 * Barrels: Simple fixtures for Sails.js
 */

var fs = require("fs");
var path = require("path");
var _ = require("lodash");

module.exports = Barrels;

var that = this;

/**
 * Barrels module
 * @param {string} sourceFolder defaults to <project root>/test/fixtures
 */
function Barrels(sourceFolder) {
	if (!(this instanceof Barrels)) return new Barrels(sourceFolder);

	// Fixture objects loaded from the JSON files
	that.data = {};

	// Map fixture positions in JSON files to the real DB IDs
	that.idMap = {};

	// The list of associations by model
	that.associations = {};

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

			that.data[modelName] = require(path.join(sourceFolder, files[i]));
		}
	}

	// The list of the fixtures model names
	that.modelNames = Object.keys(that.data);
	// console.info("that.modelNames", that.modelNames)
}

/**
 * Add associations
 * @param {function} done callback
 */
Barrels.prototype.associate = async modelNames => {
	if (!_.isArray(modelNames)) modelNames = that.modelNames;

	// Add associations whenever needed
	for (let i = 0; i < modelNames.length; i++) {
		try {
			const modelName = modelNames[i];

			var Model = sails.models[modelName];

			if (Model) {
				var fixtureObjects = _.cloneDeep(that.data[modelName]);

				for (let j = 0; j < fixtureObjects.length; j++) {
					let item = fixtureObjects[j];

					// Item position in the file
					var itemIndex = fixtureObjects.indexOf(item);

					// Find and associate
					let model = await Model.findOne({
						id: that.idMap[modelName][itemIndex]
					});
					// console.log("model", model)

					// Pick associations only
					item = _.pick(
						item,
						Object.keys(that.associations[modelName])
					);
					// console.log("item", item)

					let attributes = Object.keys(item);
					// console.log("attributes", attributes)

					for (let k = 0; k < attributes.length; k++) {
						const attr = attributes[k];
						// console.log("attr", attr)

						var association = that.associations[modelName][attr];
						// console.log("association", association)

						// Required associations should have been added earlier
						if (association.required) {
							console.warn(
								"Should have added required associations earlier"
							);
							break;
						}

						// console.log("item[attr]", item[attr])
						if (!_.isArray(item[attr]))
							model[attr] = String(item[attr]);
					}

					try {
						await Model.update({ id: model.id }, model);
					} catch (err) {
						console.error("ERROR AT MODEL UPDATE");
						throw err;
					}
				}
			}
		} catch (err) {
			console.error(err);
			break;
		}
	}
};

/**
 * Put loaded fixtures in the database, associations excluded
 * @param {array} collections optional list of collections to populate
 * @param {function} done callback
 * @param {boolean} autoAssociations automatically associate based on the order in the fixture files
 */
Barrels.prototype.populate = async function(collections, autoAssociations) {
	console.log("[Barrels] Collections", collections);

	if (!_.isArray(collections)) {
		autoAssociations = done;
		done = collections;
		collections = that.modelNames;
	} else {
		collections = _.map(collections, function(collection) {
			return collection.toLowerCase();
		});
	}

	autoAssociations = !(autoAssociations === false);

	// console.info("autoAssociations", autoAssociations)

	for (let l = 0; l < collections.length; l++) {
		const modelName = collections[l];

		var Model = sails.models[modelName];

		if (Model) {
			try {
				console.info(
					`[Barrels] Deleting ${modelName} from database...`
				);

				// Cleanup existing data in the table / collection
				await Model.destroy({});

				// Save model's association information
				that.associations[modelName] = {};

				for (var i = 0; i < Model.associations.length; i++) {
					let { alias } = Model.associations[i];

					// console.log("alias", alias)
					// console.log("Model.associations[i]", Model.associations[i])

					that.associations[modelName][alias] = Model.associations[i];
				}
			} catch (err) {
				console.error("[Barrels] Error when deleting records...", err);
				throw err;
			}

			// Insert all the fixture items
			that.idMap[modelName] = [];

			var fixtureObjects = _.cloneDeep(that.data[modelName]);

			if (!_.isArray(fixtureObjects))
				throw "You're missing a file for that model or you have not defined a valid array";

			if (_.isArray(fixtureObjects) && fixtureObjects.length <= 0)
				throw "You have an empty array defined for that model";

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
							// We're trying to access a model that isn't instantiated yet
							if (!that.idMap[collectionName])
								throw "Please provide a loading order acceptable for required associations";

							// What does that do?
							for (var j = 0; j < item[alias].length; j++)
								item[alias][j] =
									that.idMap[collectionName][
										item[alias][j] - 1
									];
						} else if (associatedModelName) {
							// We're trying to access a model that isn't instantiated yet
							if (!that.idMap[associatedModelName])
								throw "Please provide a loading order acceptable for required associations";

							// What does that do?
							item[alias] =
								that.idMap[associatedModelName][
									item[alias] - 1
								];
						}
					}
				}

				try {
					// Insert record
					let model = await Model.create(item);

					if (i === fixtureObjects.length - 1)
						console.info(
							`[Barrels] Seeded ${modelName} in database...`
						);

					// Primary key mapping
					that.idMap[modelName][i] = model[Model.primaryKey];
				} catch (err) {
					console.log("[Barrels] Error when inserting record...");
					throw err;
				}
			}
		}
	}

	// Create associations if requested
	if (autoAssociations) await this.associate(collections);
};
