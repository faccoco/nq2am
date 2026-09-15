# 搜推标志性论文

按检索 / 推荐技术史整理。有 arXiv 的给 `arxiv.org/abs`；1990 年代前后不少工业与会议论文未进 arXiv，改给官方 PDF 或 ACM / 期刊链接。

## 只读 12 篇

1. [From RankNet to LambdaRank to LambdaMART](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/MSR-TR-2010-82.pdf)
2. [DSSM](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/cikm2013_DSSM_fullversion.pdf)
3. [Deep Neural Networks for YouTube Recommendations](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/45530.pdf)
4. [Wide & Deep Learning for Recommender Systems](https://arxiv.org/abs/1606.07792)
5. [Deep Interest Network (DIN)](https://arxiv.org/abs/1706.06978)
6. [Self-Attentive Sequential Recommendation (SASRec)](https://arxiv.org/abs/1808.09781)
7. [Passage Re-ranking with BERT (monoBERT)](https://arxiv.org/abs/1901.04085)
8. [Dense Passage Retrieval (DPR)](https://arxiv.org/abs/2004.04906)
9. [ColBERT](https://arxiv.org/abs/2004.12832)
10. [Transformer Memory as a Differentiable Search Index (DSI)](https://arxiv.org/abs/2202.06991)
11. [Is ChatGPT Good at Search? (RankGPT)](https://arxiv.org/abs/2304.09542)
12. [Recommender Systems with Generative Retrieval (TIGER)](https://arxiv.org/abs/2305.05065)

---

## 前神经网络

| 年 | 论文 | 要点 | 链接 |
| --- | --- | --- | --- |
| 1975 | Salton, Wong, Yang. *A Vector Space Model for Automatic Indexing* | TF 向量空间 | [PDF](https://www.cs.utexas.edu/~mooney/ir-course/readings/vs-model.pdf) |
| 1994 | Resnick et al. *GroupLens: An Open Architecture for Collaborative Filtering of Netnews* | 协同过滤成型 | [ACM PDF](https://dl.acm.org/doi/pdf/10.1145/192844.192905) |
| 1998 | Ponte, Croft. *A Language Modeling Approach to Information Retrieval* | 查询似然 | [CIIR PDF](https://ciir-publications.cs.umass.edu/getpdf.php?id=35) |
| 1998 | Page, Brin, Motwani, Winograd. *The PageRank Citation Ranking* | 链接权威 | [Stanford TR](http://ilpubs.stanford.edu:8090/422/1/1999-66.pdf) |
| 1994 | Robertson et al. *Okapi at TREC-3* | BM25 前身 / Okapi 定型 | [PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/okapi_trec3.pdf) |
| 2003 | Blei, Ng, Jordan. *Latent Dirichlet Allocation* | 浅层主题语义 | [JMLR](https://www.jmlr.org/papers/volume3/blei03a/blei03a.pdf) |
| 2009 | Koren, Bell, Volinsky. *Matrix Factorization Techniques for Recommender Systems* | Netflix Prize 后的 MF | [IEEE PDF](https://datajobs.com/data-science-repo/Recommender-Systems-%5BNetflix%5D.pdf) |
| 2009 | Rendle et al. *BPR: Bayesian Personalized Ranking from Implicit Feedback* | 隐式反馈 pairwise 排序 | [arXiv:1205.2618](https://arxiv.org/abs/1205.2618) |
| 2010 | Rendle. *Factorization Machines* | 稀疏特征二阶交叉 | [ICDM PDF](https://www.csie.ntu.edu.tw/~b97053/paper/Rendle2010FM.pdf) · 综述 [arXiv:1505.01862](https://arxiv.org/abs/1505.01862) |

### Learning to Rank

| 年 | 论文 | 链接 |
| --- | --- | --- |
| 2005 | Burges et al. *Learning to Rank using Gradient Descent* (RankNet) | [ICML PDF](https://icml.cc/2015/wp-content/uploads/2015/06/icml_ranking.pdf) |
| 2007 | Cao et al. *Learning to Rank: From Pairwise Approach to Listwise Approach* (ListNet) | [ICML PDF](https://icml.cc/Conferences/2007/papers/321.pdf) |
| 2010 | Burges. *From RankNet to LambdaRank to LambdaMART: An Overview* | [MSR-TR-2010-82](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/MSR-TR-2010-82.pdf) |
| 2011 | Chapelle, Chang. *Yahoo! Learning to Rank Challenge Overview* | [JMLR](https://proceedings.mlr.press/v14/chapelle11a/chapelle11a.pdf) |

### 近邻检索（漏斗工程前提）

| 年 | 论文 | 链接 |
| --- | --- | --- |
| 2016 | Malkov, Yashunin. *Efficient and robust approximate nearest neighbor search using Hierarchical Navigable Small World graphs* (HNSW) | [arXiv:1603.09320](https://arxiv.org/abs/1603.09320) |
| 2017 | Johnson, Douze, Jégou. *Billion-scale similarity search with GPUs* (Faiss) | [arXiv:1702.08734](https://arxiv.org/abs/1702.08734) |

---

## 深度神经网络

### 表示与双塔召回

| 年 | 论文 | 链接 |
| --- | --- | --- |
| 2013 | Mikolov et al. *Efficient Estimation of Word Representations in Vector Space* (Word2Vec) | [arXiv:1301.3781](https://arxiv.org/abs/1301.3781) |
| 2013 | Mikolov et al. *Distributed Representations of Words and Phrases and their Compositionality* | [arXiv:1310.4546](https://arxiv.org/abs/1310.4546) |
| 2013 | Huang et al. *Learning Deep Structured Semantic Models for Web Search using Clickthrough Data* (DSSM) | [微软 PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/cikm2013_DSSM_fullversion.pdf) |
| 2016 | Barkan, Koenigstein. *Item2Vec: Neural Item Embedding for Collaborative Filtering* | [arXiv:1603.04286](https://arxiv.org/abs/1603.04286) |
| 2016 | Covington, Adams, Sargin. *Deep Neural Networks for YouTube Recommendations* | [Google PDF](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/45530.pdf) |
| 2016 | Cheng et al. *Wide & Deep Learning for Recommender Systems* | [arXiv:1606.07792](https://arxiv.org/abs/1606.07792) |
| 2017 | He et al. *Neural Collaborative Filtering* | [arXiv:1708.05031](https://arxiv.org/abs/1708.05031) |
| 2018 | Ying et al. *Graph Convolutional Neural Networks for Web-Scale Recommender Systems* (PinSage) | [arXiv:1806.01973](https://arxiv.org/abs/1806.01973) |
| 2018 | Grbovic, Cheng. *Real-time Personalization using Embeddings for Search Ranking at Airbnb* | [KDD](https://dl.acm.org/doi/10.1145/3219819.3219885) |

### CTR / 精排交叉

| 年 | 论文 | 链接 |
| --- | --- | --- |
| 2017 | Guo et al. *DeepFM: A Factorization-Machine based Neural Network for CTR Prediction* | [arXiv:1703.04247](https://arxiv.org/abs/1703.04247) |
| 2017 | Wang et al. *Deep & Cross Network for Ad Click Predictions* (DCN) | [arXiv:1708.05123](https://arxiv.org/abs/1708.05123) |
| 2018 | Zhou et al. *Deep Interest Network for Click-Through Rate Prediction* (DIN) | [arXiv:1706.06978](https://arxiv.org/abs/1706.06978) |
| 2018 | Lian et al. *xDeepFM: Combining Explicit and Implicit Feature Interactions for Recommender Systems* | [arXiv:1803.05170](https://arxiv.org/abs/1803.05170) |
| 2018 | Zhou et al. *Deep Interest Evolution Network for Click-Through Rate Prediction* (DIEN) | [arXiv:1809.03672](https://arxiv.org/abs/1809.03672) |
| 2018 | Ma et al. *Modeling Task Relationships in Multi-task Learning with Multi-gate Mixture-of-Experts* (MMoE) | [KDD](https://dl.acm.org/doi/10.1145/3219819.3220007) |
| 2018 | Ma et al. *Entire Space Multi-Task Model* (ESMM) | [arXiv:1804.07931](https://arxiv.org/abs/1804.07931) |
| 2019 | Naumov et al. *Deep Learning Recommendation Model for Personalization and Recommendation Systems* (DLRM) | [arXiv:1906.00091](https://arxiv.org/abs/1906.00091) |
| 2020 | Pi et al. *Search-based User Interest Modeling with Lifelong Sequential Behavior Data for CTR Prediction* (SIM) | [arXiv:2006.05639](https://arxiv.org/abs/2006.05639) |
| 2020 | Wang et al. *DCN V2: Improved Deep & Cross Network and Practical Lessons for Web-scale Learning to Rank* | [arXiv:2008.13566](https://arxiv.org/abs/2008.13566) |

### 序列推荐

| 年 | 论文 | 链接 |
| --- | --- | --- |
| 2015 | Hidasi et al. *Session-based Recommendations with Recurrent Neural Networks* (GRU4Rec) | [arXiv:1511.06939](https://arxiv.org/abs/1511.06939) |
| 2018 | Kang, McAuley. *Self-Attentive Sequential Recommendation* (SASRec) | [arXiv:1808.09781](https://arxiv.org/abs/1808.09781) |
| 2019 | Sun et al. *BERT4Rec: Sequential Recommendation with Bidirectional Encoder Representations from Transformer* | [arXiv:1904.06690](https://arxiv.org/abs/1904.06690) |

### 神经 IR 与稠密检索

| 年 | 论文 | 链接 |
| --- | --- | --- |
| 2016 | Guo et al. *A Deep Relevance Matching Model for Ad-hoc Retrieval* (DRMM) | [ACM CIKM](https://dl.acm.org/doi/10.1145/2983323.2983769) |
| 2017 | Xiong et al. *End-to-End Neural Ad-hoc Ranking with Kernel Pooling* (KNRM) | [arXiv:1706.06613](https://arxiv.org/abs/1706.06613) |
| 2018 | Devlin et al. *BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding* | [arXiv:1810.04805](https://arxiv.org/abs/1810.04805) |
| 2019 | Nogueira, Cho. *Passage Re-ranking with BERT* (monoBERT) | [arXiv:1901.04085](https://arxiv.org/abs/1901.04085) |
| 2019 | Reimers, Gurevych. *Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks* | [arXiv:1908.10084](https://arxiv.org/abs/1908.10084) |
| 2020 | Karpukhin et al. *Dense Passage Retrieval for Open-Domain Question Answering* (DPR) | [arXiv:2004.04906](https://arxiv.org/abs/2004.04906) |
| 2020 | Khattab, Zaharia. *ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT* | [arXiv:2004.12832](https://arxiv.org/abs/2004.12832) |
| 2020 | Xiong et al. *Approximate Nearest Neighbor Negative Contrastive Learning for Dense Text Retrieval* (ANCE) | [arXiv:2007.00808](https://arxiv.org/abs/2007.00808) |
| 2020 | Qu et al. *RocketQA: An Optimized Training Approach to Dense Passage Retrieval for Open-Domain Question Answering* | [arXiv:2010.06464](https://arxiv.org/abs/2010.06464) |
| 2021 | Formal, Lassance, Piwowarski, Clinchant. *SPLADE: Sparse Lexical and Expansion Model for First Stage Ranking* | [arXiv:2107.05720](https://arxiv.org/abs/2107.05720) |
| 2021 | Thakur et al. *BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models* | [arXiv:2104.08663](https://arxiv.org/abs/2104.08663) |

---

## LLM 与生成式检索 / 推荐

| 年 | 论文 | 要点 | 链接 |
| --- | --- | --- | --- |
| 2019 | Raffel et al. *Exploring the Limits of Transfer Learning with a Unified Text-to-Text Transformer* (T5) | 生成式底座 | [arXiv:1910.10683](https://arxiv.org/abs/1910.10683) |
| 2020 | Brown et al. *Language Models are Few-Shot Learners* (GPT-3) | 少样本指令 | [arXiv:2005.14165](https://arxiv.org/abs/2005.14165) |
| 2020 | Lewis et al. *Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks* (RAG) | 检索 + 生成 | [arXiv:2005.11401](https://arxiv.org/abs/2005.11401) |
| 2021 | Radford et al. *Learning Transferable Visual Models From Natural Language Supervision* (CLIP) | 多模态双塔 | [arXiv:2103.00020](https://arxiv.org/abs/2103.00020) |
| 2021 | Zeghidour et al. *SoundStream: An End-to-End Neural Audio Codec* (RQ-VAE) | TIGER Semantic ID 用的残差量化 | [arXiv:2107.03312](https://arxiv.org/abs/2107.03312) |
| 2022 | Tay et al. *Transformer Memory as a Differentiable Search Index* (DSI) | 查询直接生成文档 ID | [arXiv:2202.06991](https://arxiv.org/abs/2202.06991) |
| 2022 | Geng et al. *Recommendation as Language Processing (RLP): A Unified Pretrain, Personalized Prompt & Predict Paradigm* (P5) | 推荐写成自然语言 | [arXiv:2203.13366](https://arxiv.org/abs/2203.13366) |
| 2022 | Wang et al. *A Neural Corpus Indexer for Document Retrieval* (NCI) | 可扩展生成式检索 | [arXiv:2206.02743](https://arxiv.org/abs/2206.02743) |
| 2022 | Gao et al. *Precise Zero-Shot Dense Retrieval without Relevance Labels* (HyDE) | 先生成假文档再检索 | [arXiv:2212.10496](https://arxiv.org/abs/2212.10496) |
| 2023 | Touvron et al. *LLaMA: Open and Efficient Foundation Language Models* | 开源底座 | [arXiv:2302.13971](https://arxiv.org/abs/2302.13971) |
| 2023 | Shi et al. *REPLUG: Retrieval-Augmented Black-Box Language Models* | 检索增强黑盒 LLM | [arXiv:2301.12652](https://arxiv.org/abs/2301.12652) |
| 2023 | Sun et al. *Is ChatGPT Good at Search? Investigating Large Language Models as Re-Ranking Agents* (RankGPT) | LLM 列表重排 | [arXiv:2304.09542](https://arxiv.org/abs/2304.09542) |
| 2023 | Rajput et al. *Recommender Systems with Generative Retrieval* (TIGER) | Semantic ID + 生成下一物品 | [arXiv:2305.05065](https://arxiv.org/abs/2305.05065) |
| 2023 | Li et al. *Text Is All You Need: Learning Language Representations for Sequential Recommendation* (RecFormer) | 纯文本序列推荐 | [arXiv:2305.13731](https://arxiv.org/abs/2305.13731) |
| 2023 | Bao et al. *TALLRec: An Effective and Efficient Tuning Framework to Align Large Language Model with Recommendation* | 指令微调对齐推荐 | [arXiv:2305.00447](https://arxiv.org/abs/2305.00447) |
| 2023 | Zhang et al. *Recommendation as Instruction Following* (InstructRec) | 指令式推荐 | [arXiv:2308.11125](https://arxiv.org/abs/2308.11125) |
| 2024 | Li et al. *A Survey of Generative Search and Recommendation in the Era of Large Language Models* | 生成式搜推地图 | [arXiv:2404.16924](https://arxiv.org/abs/2404.16924) |
