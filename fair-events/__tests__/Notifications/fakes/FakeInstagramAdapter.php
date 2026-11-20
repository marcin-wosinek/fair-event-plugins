<?php
/**
 * FakeInstagramAdapter test double.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

/**
 * The adapter, answering with the fake posting or as unavailable.
 */
class FakeInstagramAdapter {

	/**
	 * Posting, or null while unavailable.
	 *
	 * @var FakeInstagramPosts|null
	 */
	public $posts;

	/**
	 * Constructor.
	 *
	 * @param FakeInstagramPosts|null $posts Posting.
	 */
	public function __construct( $posts ) {
		$this->posts = $posts;
	}

	/**
	 * Availability.
	 *
	 * @return string
	 */
	public function availability() {
		return $this->posts ? 'active' : 'instagram_unavailable';
	}

	/**
	 * Message.
	 *
	 * @param string $availability Availability.
	 * @return string
	 */
	public function message( $availability ) {
		return 'active' === $availability ? '' : 'Turn on Instagram.';
	}

	/**
	 * Posting.
	 *
	 * @return FakeInstagramPosts|null
	 */
	public function posts() {
		return $this->posts;
	}
}
