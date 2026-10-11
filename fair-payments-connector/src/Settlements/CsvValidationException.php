<?php
/**
 * Settlement CSV validation failure
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Settlements;

defined( 'WPINC' ) || die;

/**
 * Thrown when an uploaded settlement CSV cannot be imported as it is.
 */
class CsvValidationException extends \Exception {

	/**
	 * Problems found, each `array( 'code' => string, 'message' => string, 'row' => int|null )`.
	 *
	 * @var array[]
	 */
	private $errors;

	/**
	 * Constructor.
	 *
	 * @param array[] $errors Problems found.
	 */
	public function __construct( array $errors ) {
		parent::__construct( (string) ( $errors[0]['message'] ?? '' ) );
		$this->errors = $errors;
	}

	/**
	 * Problems found.
	 *
	 * @return array[]
	 */
	public function get_errors() {
		return $this->errors;
	}
}
