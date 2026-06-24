<?php
/**
 * Submission Detail Page
 *
 * @package FairForm
 */

namespace FairForm\Admin;

defined( 'WPINC' ) || die;

/**
 * Submission detail admin page.
 */
class SubmissionDetailPage {
	/**
	 * Render page.
	 */
	public function render() {
		echo '<div id="fair-form-submission-detail-root"></div>';
	}
}
