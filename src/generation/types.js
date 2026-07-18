/**
 * @typedef {Object} InventoryItem
 * @property {string} label
 * @property {"brick" | "plate" | string} category
 * @property {string} part_id
 * @property {string} ldraw_id
 * @property {string} color_name
 * @property {string} color_id
 * @property {number} count
 * @property {boolean} supported
 * @property {string=} rebrickable_part_num
 * @property {number=} confidence
 */

/**
 * @typedef {Object} Inventory
 * @property {string} inventory_id
 * @property {"camera_scan" | "photo_upload" | "manual_test_fixture" | string} source
 * @property {InventoryItem[]} items
 */

/**
 * @typedef {Object} GridPosition
 * @property {number} x
 * @property {number} y
 * @property {number} z
 */

/**
 * @typedef {Object} PlacedBrick
 * @property {string} id
 * @property {string} part_id
 * @property {string} ldraw_id
 * @property {string} label
 * @property {string} color_id
 * @property {string} color_name
 * @property {GridPosition} position
 * @property {0 | 90 | 180 | 270} rotation
 * @property {string} feature
 * @property {number} step
 */

/**
 * @typedef {Object} GeneratedModel
 * @property {string} model_name
 * @property {string} prompt
 * @property {number} piece_count
 * @property {{ width_studs: number, depth_studs: number, height_layers: number }} dimensions
 * @property {string} created_from_inventory_id
 * @property {string} generator_version
 * @property {PlacedBrick[]} bricks
 * @property {string[]} notes
 */

/**
 * @typedef {Object} ValidationIssue
 * @property {string} type
 * @property {"hard" | "soft"} severity
 * @property {string} message
 * @property {string=} brick_instance_id
 * @property {string=} part_id
 * @property {string=} color_id
 * @property {number=} available
 * @property {number=} used
 */

/**
 * @typedef {Object} InventoryUsage
 * @property {string} part_id
 * @property {string} color_id
 * @property {number} available
 * @property {number} used
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid
 * @property {ValidationIssue[]} errors
 * @property {ValidationIssue[]} warnings
 * @property {InventoryUsage[]} inventory_usage
 */

export {};
