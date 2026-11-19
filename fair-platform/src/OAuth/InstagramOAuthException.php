<?php
/**
 * Instagram Unified Login failure
 *
 * @package FairPlatform
 */

namespace FairPlatform\OAuth;

defined( 'ABSPATH' ) || die;

/**
 * A step of the Instagram Unified Login flow failed. The reason is one of the
 * InstagramUnifiedLogin::ERROR_* codes: a fixed, credential-free value that is
 * safe to log and to return to the originating site.
 */
class InstagramOAuthException extends \RuntimeException {

	/**
	 * Failure code.
	 *
	 * @var string
	 */
	private $reason;

	/**
	 * Constructor.
	 *
	 * @param string $reason One of the InstagramUnifiedLogin::ERROR_* codes.
	 */
	public function __construct( $reason ) {
		parent::__construct( $reason );
		$this->reason = (string) $reason;
	}

	/**
	 * Failure code.
	 *
	 * @return string
	 */
	public function reason() {
		return $this->reason;
	}
}
