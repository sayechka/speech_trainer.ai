import AnalysisClient from "./_components/AnalysisClient"

export default async function Page({
  params,
}: {
  params: Promise<{ uploadId: string }>
}) {
  const { uploadId } = await params
  return <AnalysisClient uploadId={uploadId} />
}
