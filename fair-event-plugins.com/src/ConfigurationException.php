<?php
/**
 * Raised when the standalone site's server configuration is missing or invalid.
 *
 * @package MarcinWosinek\FairEventPluginsCom
 */

namespace MarcinWosinek\FairEventPluginsCom;

/**
 * Configuration failure. Messages are for server logs, never for responses.
 */
class ConfigurationException extends \RuntimeException {
}
